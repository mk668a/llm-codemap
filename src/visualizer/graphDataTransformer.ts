import { GraphData, GraphNode, GraphEdge, NodeType, EdgeType } from '../analyzer/types';

/**
 * D3.js用のデータ変換
 */
export interface D3Node {
  id: string;
  label: string;
  type: string;
  group: number;
  filePath?: string;
  line?: number;
  column?: number;
  metadata?: any;
}

export interface D3Link {
  source: string;
  target: string;
  type: string;
  label?: string;
  value?: number;
}

export interface D3GraphData {
  nodes: D3Node[];
  links: D3Link[];
}

/**
 * GraphDataをD3.js用の形式に変換
 */
export function transformToD3Format(graphData: GraphData): D3GraphData {
  const nodes = graphData.nodes.map((node) => transformNode(node));
  const links = graphData.edges.map((edge) => transformLink(edge));

  return { nodes, links };
}

/**
 * GraphNodeをD3Nodeに変換
 */
function transformNode(node: GraphNode): D3Node {
  // ノードタイプに基づいてグループを決定
  const group = getNodeGroup(node.type);

  return {
    id: node.id,
    label: node.label,
    type: String(node.type), // enumを明示的に文字列に変換
    group,
    filePath: node.filePath,
    line: node.line,
    column: node.column,
    metadata: node.metadata,
  };
}

/**
 * GraphEdgeをD3Linkに変換（source/targetは常にノードID）
 */
function transformLink(edge: GraphEdge): D3Link {
  return {
    source: String(edge.source),
    target: String(edge.target),
    type: String(edge.type),
    label: edge.label,
    value: getEdgeValue(edge.type),
  };
}

/**
 * ノードタイプに基づいてグループ番号を取得
 */
function getNodeGroup(nodeType: NodeType): number {
  switch (nodeType) {
    case NodeType.File:
      return 1;
    case NodeType.Function:
      return 2;
    case NodeType.Class:
      return 3;
    case NodeType.Method:
      return 4;
    case NodeType.Interface:
      return 5;
    case NodeType.Type:
      return 6;
    case NodeType.Variable:
      return 7;
    default:
      return 0;
  }
}

/**
 * エッジタイプに基づいて値を取得（エッジの太さなどに使用）
 */
function getEdgeValue(edgeType: EdgeType): number {
  switch (edgeType) {
    case EdgeType.Import:
      return 1;
    case EdgeType.Export:
      return 1;
    case EdgeType.Call:
      return 2;
    case EdgeType.Extends:
      return 3;
    case EdgeType.Implements:
      return 2;
    case EdgeType.Reference:
      return 1;
    default:
      return 1;
  }
}

/**
 * ノードの色を取得（D3.jsの可視化で使用）
 */
export function getNodeColor(nodeType: NodeType): string {
  switch (nodeType) {
    case NodeType.File:
      return '#1f77b4'; // 青
    case NodeType.Function:
      return '#ff7f0e'; // オレンジ
    case NodeType.Class:
      return '#2ca02c'; // 緑
    case NodeType.Method:
      return '#d62728'; // 赤
    case NodeType.Interface:
      return '#9467bd'; // 紫
    case NodeType.Type:
      return '#8c564b'; // 茶色
    case NodeType.Variable:
      return '#e377c2'; // ピンク
    default:
      return '#7f7f7f'; // グレー
  }
}

/**
 * エッジの色を取得
 */
export function getEdgeColor(edgeType: EdgeType): string {
  switch (edgeType) {
    case EdgeType.Import:
      return '#1f77b4'; // 青
    case EdgeType.Export:
      return '#2ca02c'; // 緑
    case EdgeType.Call:
      return '#ff7f0e'; // オレンジ
    case EdgeType.Extends:
      return '#d62728'; // 赤
    case EdgeType.Implements:
      return '#9467bd'; // 紫
    case EdgeType.Reference:
      return '#7f7f7f'; // グレー
    default:
      return '#7f7f7f';
  }
}
