import * as vscode from 'vscode';
import * as path from 'path';
import { GraphData } from '../analyzer/types';
import { transformToD3Format } from './graphDataTransformer';

/**
 * LLM Code Map WebviewViewプロバイダー
 */
export class CodemapViewProvider implements vscode.WebviewViewProvider {
  public static readonly viewType = 'codemapView';
  private _view?: vscode.WebviewView;
  private _graphData?: GraphData;

  constructor(private readonly _extensionUri: vscode.Uri) {}

  public resolveWebviewView(
    webviewView: vscode.WebviewView,
    context: vscode.WebviewViewResolveContext,
    _token: vscode.CancellationToken
  ) {
    console.log('[LLM-CodeMap] Resolving webview view...');
    this._view = webviewView;

    webviewView.webview.options = {
      enableScripts: true,
      localResourceRoots: [this._extensionUri],
    };

    webviewView.webview.html = this._getHtmlForWebview(webviewView.webview);

    // メッセージハンドラー
    webviewView.webview.onDidReceiveMessage(async (data) => {
      switch (data.type) {
        case 'refresh':
          // リフレッシュは外部から呼び出される
          break;
        case 'nodeClick':
          // ノードクリック時にファイルを開く
          if (data.filePath) {
            const uri = vscode.Uri.file(data.filePath);
            const doc = await vscode.workspace.openTextDocument(uri);
            const editor = await vscode.window.showTextDocument(doc);

            // 行と列が指定されている場合はその位置に移動
            if (data.line !== undefined) {
              const position = new vscode.Position(
                data.line - 1,
                data.column ? data.column - 1 : 0
              );
              editor.selection = new vscode.Selection(position, position);
              editor.revealRange(new vscode.Range(position, position));
            }
          }
          break;
        case 'ready':
          // Webviewが準備できたら、既存のデータがあれば送信
          if (this._graphData) {
            this.updateGraph(this._graphData);
          }
          break;
      }
    });
  }

  /**
   * グラフデータを更新
   */
  public updateGraph(graphData: GraphData): void {
    console.log(
      `[LLM-CodeMap] updateGraph called with ${graphData.nodes.length} nodes, ${graphData.edges.length} edges`
    );

    // デバッグ: エッジの詳細をログ出力
    if (graphData.edges.length > 0) {
      console.log(
        `[LLM-CodeMap] Sample edges:`,
        graphData.edges.slice(0, 3).map((e) => ({
          id: e.id,
          source: e.source,
          target: e.target,
          type: e.type,
          label: e.label,
        }))
      );
    } else {
      console.warn(`[LLM-CodeMap] No edges in graph data!`);
    }

    this._graphData = graphData;

    if (!this._view) {
      console.warn('[LLM-CodeMap] WebviewView is not available, cannot update graph');
      return;
    }

    // D3.js用の形式に変換
    const d3Data = transformToD3Format(graphData);
    console.log(
      `[LLM-CodeMap] Transformed to D3 format: ${d3Data.nodes.length} nodes, ${d3Data.links.length} links`
    );

    // デバッグ: D3リンクの詳細をログ出力
    if (d3Data.links.length > 0) {
      console.log(
        `[LLM-CodeMap] Sample D3 links:`,
        d3Data.links.slice(0, 3).map((l) => ({
          source: l.source,
          target: l.target,
          type: l.type,
          label: l.label,
        }))
      );
    } else {
      console.warn(`[LLM-CodeMap] No links in D3 data!`);
    }

    // Webviewにデータを送信
    try {
      this._view.webview.postMessage({
        type: 'updateGraph',
        data: d3Data,
      });
      console.log('[LLM-CodeMap] Graph data sent to webview');
    } catch (error) {
      console.error('[LLM-CodeMap] Failed to send graph data to webview:', error);
    }
  }

  /**
   * Webview用のHTMLを生成
   */
  private _getHtmlForWebview(webview: vscode.Webview): string {
    // D3.jsをローカルリソースから読み込む
    const d3ScriptUri = webview.asWebviewUri(
      vscode.Uri.joinPath(this._extensionUri, 'media', 'd3.v7.min.js')
    );

    return `<!DOCTYPE html>
<html lang="ja">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>LLM Code Map</title>
    <style>
        body {
            margin: 0;
            padding: 0;
            font-family: var(--vscode-font-family);
            color: var(--vscode-foreground);
            background-color: var(--vscode-editor-background);
            overflow: hidden;
        }
        #graph-container {
            width: 100%;
            height: 100vh;
            position: relative;
        }
        svg {
            width: 100%;
            height: 100%;
        }
        .node {
            cursor: pointer;
        }
        .node circle {
            stroke: var(--vscode-foreground);
            stroke-width: 2px;
        }
        .node text {
            font-size: 12px;
            fill: var(--vscode-foreground);
            pointer-events: none;
        }
        .link {
            stroke: #999;
            stroke-opacity: 0.8;
            stroke-width: 2px;
            fill: none;
        }
        .link.import {
            stroke: #1f77b4;
            stroke-width: 2.5px;
        }
        .link.export {
            stroke: #2ca02c;
            stroke-width: 2.5px;
        }
        .link.call {
            stroke: #ff7f0e;
            stroke-width: 3px;
        }
        .link.extends {
            stroke: #d62728;
            stroke-width: 3px;
        }
        .link.implements {
            stroke: #9467bd;
            stroke-width: 2.5px;
        }
        .link.reference {
            stroke: #7f7f7f;
            stroke-width: 1.5px;
            stroke-opacity: 0.5;
        }
        .tooltip {
            position: absolute;
            padding: 8px;
            background: var(--vscode-editor-background);
            border: 1px solid var(--vscode-panel-border);
            border-radius: 4px;
            pointer-events: none;
            font-size: 12px;
            opacity: 0;
            transition: opacity 0.2s;
        }
        .tooltip.visible {
            opacity: 1;
        }
        #controls {
            position: absolute;
            top: 10px;
            right: 10px;
            z-index: 1000;
            background: var(--vscode-editor-background);
            padding: 10px;
            border-radius: 4px;
            border: 1px solid var(--vscode-panel-border);
        }
        button {
            background: var(--vscode-button-background);
            color: var(--vscode-button-foreground);
            border: none;
            padding: 6px 12px;
            margin: 2px;
            border-radius: 2px;
            cursor: pointer;
            font-size: 12px;
        }
        button:hover {
            background: var(--vscode-button-hoverBackground);
        }
        #info {
            position: absolute;
            bottom: 10px;
            left: 10px;
            background: var(--vscode-editor-background);
            padding: 8px;
            border-radius: 4px;
            border: 1px solid var(--vscode-panel-border);
            font-size: 11px;
            opacity: 0.8;
        }
    </style>
</head>
<body>
    <div id="graph-container">
        <div id="controls">
            <button id="zoom-in">Zoom In</button>
            <button id="zoom-out">Zoom Out</button>
            <button id="reset">Reset</button>
            <button id="center">Center</button>
        </div>
        <div id="info">Nodes: 0 | Links: 0</div>
        <div class="tooltip" id="tooltip"></div>
    </div>
    <script src="${d3ScriptUri}"></script>
    <script>
        console.log('[LLM-CodeMap Webview] Script loading...');
        const vscode = acquireVsCodeApi();
        console.log('[LLM-CodeMap Webview] vscode API acquired');
        
        let svg, simulation, nodes, links, nodeElements, linkElements, labelElements;
        let width, height;
        let transform = d3.zoomIdentity;
        let tooltip = d3.select('#tooltip');
        let linkSelection; // リンクのセレクションを保持
        let nodeSelection; // ノードのセレクションを保持
        
        console.log('[LLM-CodeMap Webview] Variables initialized');
        
        // 色の定義
        const nodeColors = {
            'file': '#1f77b4',
            'function': '#ff7f0e',
            'class': '#2ca02c',
            'method': '#d62728',
            'interface': '#9467bd',
            'type': '#8c564b',
            'variable': '#e377c2'
        };
        
        const edgeColors = {
            'import': '#1f77b4',
            'export': '#2ca02c',
            'call': '#ff7f0e',
            'extends': '#d62728',
            'implements': '#9467bd',
            'reference': '#7f7f7f'
        };
        
        function initGraph() {
            console.log('[LLM-CodeMap Webview] initGraph called');
            const container = d3.select('#graph-container');
            if (!container.node()) {
                console.error('[LLM-CodeMap Webview] graph-container not found!');
                return;
            }
            width = container.node().clientWidth;
            height = container.node().clientHeight;
            console.log('[LLM-CodeMap Webview] Container size: ' + width + 'x' + height);
            
            svg = d3.select('#graph-container')
                .append('svg')
                .attr('width', width)
                .attr('height', height);
            
            // 矢印マーカーの定義（各エッジタイプごと）
            const defs = svg.append('defs');
            
            // 既存のマーカーを削除（重複を防ぐ）
            defs.selectAll('marker').remove();
            
            // 各エッジタイプ用の矢印マーカーを作成
            Object.keys(edgeColors).forEach(type => {
                defs.append('marker')
                    .attr('id', 'arrowhead-' + type)
                    .attr('viewBox', '0 -5 10 10')
                    .attr('refX', 8)
                    .attr('refY', 0)
                    .attr('markerWidth', 8)
                    .attr('markerHeight', 8)
                    .attr('orient', 'auto')
                    .append('path')
                    .attr('d', 'M0,-5L10,0L0,5')
                    .attr('fill', edgeColors[type] || '#999');
            });
            
            // デフォルトの矢印マーカー
            defs.append('marker')
                .attr('id', 'arrowhead')
                .attr('viewBox', '0 -5 10 10')
                .attr('refX', 8)
                .attr('refY', 0)
                .attr('markerWidth', 8)
                .attr('markerHeight', 8)
                .attr('orient', 'auto')
                .append('path')
                .attr('d', 'M0,-5L10,0L0,5')
                .attr('fill', '#999');
            
            // ズーム機能
            const zoom = d3.zoom()
                .scaleExtent([0.1, 4])
                .on('zoom', (event) => {
                    transform = event.transform;
                    svg.select('g').attr('transform', event.transform);
                });
            
            svg.call(zoom);
            
            // メイングループ
            const g = svg.append('g');
            
            // リンク（背景に描画）
            linkElements = g.append('g').attr('class', 'links');
            
            // ノード（前面に描画）
            nodeElements = g.append('g').attr('class', 'nodes');
            
            // ラベル
            labelElements = g.append('g').attr('class', 'labels');
            
            // コントロール
            d3.select('#zoom-in').on('click', () => {
                svg.transition().call(zoom.scaleBy, 1.5);
            });
            
            d3.select('#zoom-out').on('click', () => {
                svg.transition().call(zoom.scaleBy, 1 / 1.5);
            });
            
            d3.select('#reset').on('click', () => {
                svg.transition().call(zoom.transform, d3.zoomIdentity);
            });
            
            d3.select('#center').on('click', () => {
                if (nodes && nodes.length > 0) {
                    const bounds = svg.node().getBBox();
                    const fullWidth = bounds.width;
                    const fullHeight = bounds.height;
                    const midX = -bounds.x + (width - fullWidth) / 2;
                    const midY = -bounds.y + (height - fullHeight) / 2;
                    
                    svg.transition().call(
                        zoom.transform,
                        d3.zoomIdentity.translate(midX, midY)
                    );
                }
            });
            
            // ウィンドウリサイズ
            window.addEventListener('resize', () => {
                width = container.node().clientWidth;
                height = container.node().clientHeight;
                svg.attr('width', width).attr('height', height);
                if (simulation) {
                    simulation.force('center', d3.forceCenter(width / 2, height / 2));
                    simulation.alpha(0.3).restart();
                }
            });
        }
        
        function updateGraph(data) {
            console.log('[LLM-CodeMap Webview] updateGraph called');
            console.log('[LLM-CodeMap Webview] Data received:', data ? 'valid' : 'null');
            
            if (!data || !data.nodes || !data.links) {
                console.error('[LLM-CodeMap Webview] Invalid graph data:', data);
                console.error('[LLM-CodeMap Webview] Data structure:', {
                    hasData: !!data,
                    hasNodes: !!(data && data.nodes),
                    hasLinks: !!(data && data.links),
                    nodesType: data && data.nodes ? typeof data.nodes : 'undefined',
                    linksType: data && data.links ? typeof data.links : 'undefined'
                });
                return;
            }
            
            console.log('[LLM-CodeMap Webview] Graph data: ' + data.nodes.length + ' nodes, ' + data.links.length + ' links');
            
            // ノードタイプの分布をログ出力
            const typeCounts = {};
            data.nodes.forEach(n => {
                typeCounts[n.type] = (typeCounts[n.type] || 0) + 1;
            });
            console.log('[LLM-CodeMap Webview] Node type distribution:', typeCounts);
            
            // エッジタイプの分布をログ出力
            const edgeTypeCounts = {};
            data.links.forEach(e => {
                edgeTypeCounts[e.type] = (edgeTypeCounts[e.type] || 0) + 1;
            });
            console.log('[LLM-CodeMap Webview] Edge type distribution:', edgeTypeCounts);
            
            // 親子関係のエッジを確認
            const parentChildLinks = data.links.filter(l => l.type === 'reference' && l.label === 'contains');
            console.log('[LLM-CodeMap Webview] Parent-child links:', parentChildLinks.length);
            if (parentChildLinks.length > 0 && parentChildLinks.length <= 5) {
                const sampleLinks = parentChildLinks.map(l => {
                    const sourceId = typeof l.source === 'object' ? l.source.id : l.source;
                    const targetId = typeof l.target === 'object' ? l.target.id : l.target;
                    return sourceId + ' -> ' + targetId;
                });
                console.log('[LLM-CodeMap Webview] Sample parent-child links:', sampleLinks);
            }
            
            // データを更新
            nodes = data.nodes.map(d => Object.assign({}, d));
            links = data.links.map(d => Object.assign({}, d));
            
            // 情報を更新
            d3.select('#info').text('Nodes: ' + nodes.length + ' | Links: ' + links.length);
            
            // ノードに初期位置を設定（リンクがない場合でも表示されるように）
            nodes.forEach((node, i) => {
                if (!node.x && !node.y) {
                    const angle = (i / nodes.length) * 2 * Math.PI;
                    const radius = Math.min(width, height) * 0.3;
                    node.x = width / 2 + radius * Math.cos(angle);
                    node.y = height / 2 + radius * Math.sin(angle);
                }
            });
            
            // デバッグ: ノードIDのリストを確認
            console.log('[LLM-CodeMap Webview] Available node IDs:', nodes.slice(0, 5).map(n => n.id));
            
            // リンクの妥当性チェック（source/targetは常にID文字列）
            const beforeCount = links.length;
            links = links.filter((link, index) => {
                const sourceNode = nodes.find(n => n.id === link.source);
                const targetNode = nodes.find(n => n.id === link.target);
                if (!sourceNode) {
                    console.warn('[LLM-CodeMap Webview] Source node not found for link ' + index + ': ' + link.source);
                }
                if (!targetNode) {
                    console.warn('[LLM-CodeMap Webview] Target node not found for link ' + index + ': ' + link.target);
                }
                return !!(sourceNode && targetNode);
            });
            console.log('[LLM-CodeMap Webview] Valid links after filtering: ' + links.length + ' (was ' + beforeCount + ')');
            // デバッグ出力
            links.slice(0, 5).forEach((link, i) => {
                const sourceNode = nodes.find(n => n.id === link.source);
                const targetNode = nodes.find(n => n.id === link.target);
                console.log('[LLM-CodeMap Webview] Link ' + i + ': ' + link.source + ' -> ' + link.target +
                    ' (source found: ' + (sourceNode ? 'yes' : 'no') + ', target found: ' + (targetNode ? 'yes' : 'no') + ')');
            });
            
            // フォースシミュレーション
            simulation = d3.forceSimulation(nodes)
                .force('link', links.length > 0 ? d3.forceLink(links).id(d => d.id).distance(100) : null)
                .force('charge', d3.forceManyBody().strength(-300))
                .force('center', d3.forceCenter(width / 2, height / 2))
                .force('collision', d3.forceCollide().radius(30));
            
            console.log('[LLM-CodeMap Webview] Simulation created with ' + nodes.length + ' nodes, ' + links.length + ' links');
            
            // リンクを描画
            console.log('[LLM-CodeMap Webview] Rendering links: ' + links.length + ' links available');
            
            // linkElementsが未定義の場合は初期化
            if (!linkElements) {
                console.warn('[LLM-CodeMap Webview] linkElements is undefined, initializing...');
                const g = svg.select('g');
                if (g.empty()) {
                    console.error('[LLM-CodeMap Webview] Main group not found!');
                    return;
                }
                linkElements = g.append('g').attr('class', 'links');
            }
            
            // 既存のリンクをすべて削除
            linkElements.selectAll('line').remove();
            
            if (links.length > 0) {
                console.log('[LLM-CodeMap Webview] Creating ' + links.length + ' links...');
                
                // リンクをデータバインドして作成
                linkSelection = linkElements
                    .selectAll('line')
                    .data(links, d => {
                        return d.source + '-' + d.target + '-' + (d.type || '');
                    });
                
                // 削除
                linkSelection.exit().remove();
                
                // 新規追加
                const linkEnter = linkSelection.enter()
                    .append('line')
                    .attr('class', d => 'link ' + (d.type || ''))
                    .attr('stroke', d => {
                        const typeStr = String(d.type || 'reference');
                        const color = edgeColors[typeStr] || '#999';
                        return color;
                    })
                    .attr('stroke-width', d => {
                        const width = Math.max(1.5, Math.sqrt(d.value || 1) * 1.5);
                        return width;
                    })
                    .attr('stroke-opacity', 0.8)
                    .attr('marker-end', d => {
                        const typeStr = String(d.type || 'reference');
                        const markerId = typeStr && edgeColors[typeStr] ? 'arrowhead-' + typeStr : 'arrowhead';
                        return 'url(#' + markerId + ')';
                    })
                    .attr('x1', 0)
                    .attr('y1', 0)
                    .attr('x2', 0)
                    .attr('y2', 0);
                
                // マージ
                linkSelection = linkEnter.merge(linkSelection);
                
                console.log('[LLM-CodeMap Webview] After merge: ' + linkSelection.size() + ' links in selection');
                
                // 既存のリンクのスタイルも更新
                linkSelection
                    .attr('stroke', d => {
                        const typeStr = String(d.type || 'reference');
                        return edgeColors[typeStr] || '#999';
                    })
                    .attr('stroke-width', d => Math.max(1.5, Math.sqrt(d.value || 1) * 1.5))
                    .attr('stroke-opacity', 0.8)
                    .attr('marker-end', d => {
                        const typeStr = String(d.type || 'reference');
                        const markerId = typeStr && edgeColors[typeStr] ? 'arrowhead-' + typeStr : 'arrowhead';
                        return 'url(#' + markerId + ')';
                    });
                
                // 実際にDOMに追加されたリンクの数を確認
                const actualLinks = linkElements.selectAll('line').size();
                console.log('[LLM-CodeMap Webview] Rendered ' + linkSelection.size() + ' links (actual DOM elements: ' + actualLinks + ')');
                
                // デバッグ: 最初の数個のリンクの詳細をログ出力
                if (links.length > 0 && links.length <= 5) {
                    links.forEach((link, i) => {
                        const sourceId = typeof link.source === 'object' ? link.source.id : link.source;
                        const targetId = typeof link.target === 'object' ? link.target.id : link.target;
                        console.log('[LLM-CodeMap Webview] Link ' + i + ': ' + sourceId + ' -> ' + targetId + ' (type: ' + link.type + ')');
                    });
                }
            } else {
                console.warn('[LLM-CodeMap Webview] No links to render!');
                linkSelection = linkElements.selectAll('line');
            }
            
            // ノードを描画
            nodeSelection = nodeElements
                .selectAll('g.node')
                .data(nodes, d => d.id);
            
            nodeSelection.exit().remove();
            
            const nodeEnter = nodeSelection.enter()
                .append('g')
                .attr('class', 'node')
                .call(d3.drag()
                    .on('start', dragstarted)
                    .on('drag', dragged)
                    .on('end', dragended));
            
            nodeEnter.append('circle')
                .attr('r', d => {
                    const typeStr = String(d.type);
                    if (typeStr === 'file') return 15;
                    if (typeStr === 'class') return 12;
                    if (typeStr === 'function') return 10;
                    if (typeStr === 'method') return 8;
                    return 6;
                })
                .attr('fill', d => {
                    const typeStr = String(d.type);
                    const color = nodeColors[typeStr] || '#7f7f7f';
                    console.log('[LLM-CodeMap Webview] Node color for type ' + typeStr + ' (raw: ' + d.type + '): ' + color);
                    return color;
                })
                .attr('stroke', '#fff')
                .attr('stroke-width', 2.5);
            
            nodeEnter.append('text')
                .text(d => d.label)
                .attr('dx', d => {
                    const typeStr = String(d.type);
                    const radius = typeStr === 'file' ? 18 : typeStr === 'class' ? 15 : typeStr === 'function' ? 13 : 11;
                    return radius;
                })
                .attr('dy', 4)
                .attr('font-size', d => {
                    const typeStr = String(d.type);
                    return typeStr === 'file' ? '12px' : '11px';
                })
                .attr('font-weight', d => {
                    const typeStr = String(d.type);
                    return typeStr === 'file' ? 'bold' : 'normal';
                })
                .attr('fill', 'var(--vscode-foreground)');
            
            nodeSelection = nodeEnter.merge(nodeSelection);
            
            // 既存のノードの色も更新
            nodeSelection.select('circle')
                .attr('fill', d => {
                    const typeStr = String(d.type);
                    const color = nodeColors[typeStr] || '#7f7f7f';
                    return color;
                });
            
            console.log('[LLM-CodeMap Webview] Rendered ' + nodeSelection.size() + ' nodes');
            
            // イベントハンドラー
            nodeSelection.on('click', (event, d) => {
                if (d.filePath) {
                    vscode.postMessage({
                        type: 'nodeClick',
                        filePath: d.filePath,
                        line: d.line,
                        column: d.column
                    });
                }
            });
            
            nodeSelection.on('mouseover', (event, d) => {
                let html = '<strong>' + d.label + '</strong><br/>';
                html += 'Type: ' + d.type + '<br/>';
                if (d.filePath) {
                    html += 'File: ' + d.filePath + '<br/>';
                }
                if (d.line) {
                    html += 'Line: ' + d.line;
                }
                tooltip
                    .html(html)
                    .style('left', (event.pageX + 10) + 'px')
                    .style('top', (event.pageY - 10) + 'px')
                    .classed('visible', true);
            });
            
            nodeSelection.on('mouseout', () => {
                tooltip.classed('visible', false);
            });
            
            // シミュレーションの更新
            let tickCount = 0;
            simulation.on('tick', () => {
                tickCount++;
                
                // リンクを常に更新（エッジが0個でもエラーにならないように）
                if (links.length > 0) {
                    // linkSelectionが未定義の場合は再取得
                    if (!linkSelection || linkSelection.empty()) {
                        linkSelection = linkElements.selectAll('line');
                    }
                    
                    // 最初の数回のtickでデバッグログを出力
                    if (tickCount <= 3) {
                        console.log('[LLM-CodeMap Webview] Tick ' + tickCount + ': Updating ' + linkSelection.size() + ' links');
                        if (links.length > 0) {
                            const firstLink = links[0];
                            const source = nodes.find(n => n.id === firstLink.source);
                            const target = nodes.find(n => n.id === firstLink.target);
                            console.log('[LLM-CodeMap Webview] First link source: ' + (source ? (source.x + ',' + source.y) : 'not found') + ', target: ' + (target ? (target.x + ',' + target.y) : 'not found'));
                        }
                    }
                    
                    // リンクの座標を更新
                    linkSelection
                        .attr('x1', d => {
                            const source = nodes.find(n => n.id === d.source);
                            if (!source) {
                                const sourceId = d.source;
                                if (tickCount <= 3) {
                                    console.warn('[LLM-CodeMap Webview] Source not found in tick: ' + sourceId);
                                }
                                return 0;
                            }
                            const x = source.x !== undefined ? source.x : 0;
                            return x;
                        })
                        .attr('y1', d => {
                            const source = nodes.find(n => n.id === d.source);
                            if (!source) {
                                return 0;
                            }
                            const y = source.y !== undefined ? source.y : 0;
                            return y;
                        })
                        .attr('x2', d => {
                            const target = nodes.find(n => n.id === d.target);
                            if (!target) {
                                const targetId = d.target;
                                if (tickCount <= 3) {
                                    console.warn('[LLM-CodeMap Webview] Target not found in tick: ' + targetId);
                                }
                                return 0;
                            }
                            const x = target.x !== undefined ? target.x : 0;
                            return x;
                        })
                        .attr('y2', d => {
                            const target = nodes.find(n => n.id === d.target);
                            if (!target) {
                                return 0;
                            }
                            const y = target.y !== undefined ? target.y : 0;
                            return y;
                        });
                }
                
                // ノードの位置を更新
                if (nodeSelection) {
                    nodeSelection
                        .attr('transform', d => 'translate(' + (d.x || 0) + ',' + (d.y || 0) + ')');
                }
            });
            
            // シミュレーションを開始
            simulation.alpha(1).restart();
            
            function dragstarted(event, d) {
                if (!event.active) simulation.alphaTarget(0.3).restart();
                d.fx = d.x;
                d.fy = d.y;
            }
            
            function dragged(event, d) {
                d.fx = event.x;
                d.fy = event.y;
            }
            
            function dragended(event, d) {
                if (!event.active) simulation.alphaTarget(0);
                d.fx = null;
                d.fy = null;
            }
        }
        
        // メッセージ受信
        console.log('[LLM-CodeMap Webview] Setting up message listener...');
        window.addEventListener('message', event => {
            console.log('[LLM-CodeMap Webview] Message event received:', event);
            const message = event.data;
            if (!message) {
                console.warn('[LLM-CodeMap Webview] Received null message');
                return;
            }
            console.log('[LLM-CodeMap Webview] Received message type:', message.type);
            switch (message.type) {
                case 'updateGraph':
                    console.log('[LLM-CodeMap Webview] Updating graph with data: nodes=' + (message.data?.nodes?.length || 0) + ', links=' + (message.data?.links?.length || 0));
                    updateGraph(message.data);
                    break;
                default:
                    console.warn('[LLM-CodeMap Webview] Unknown message type:', message.type);
            }
        });
        
        // 初期化
        console.log('[LLM-CodeMap Webview] Initializing graph...');
        initGraph();
        
        // 準備完了を通知
        console.log('[LLM-CodeMap Webview] Sending ready message...');
        try {
            vscode.postMessage({ type: 'ready' });
            console.log('[LLM-CodeMap Webview] Ready message sent successfully');
        } catch (error) {
            console.error('[LLM-CodeMap Webview] Failed to send ready message:', error);
        }
    </script>
</body>
</html>`;
  }
}
