import * as ts from 'typescript';
import * as path from 'path';
import {
  GraphNode,
  GraphEdge,
  GraphData,
  NodeType,
  EdgeType,
  FunctionInfo,
  ClassInfo,
  ImportInfo,
  ExportInfo,
} from './types';
import { TypeScriptAnalyzer } from './TypeScriptAnalyzer';
import { normalizePath } from '../utils/pathUtils';
import * as fs from 'fs';
import { ICodemapParameters } from '../tools/types';

/**
 * 依存関係抽出エンジン
 */
export class DependencyExtractor {
  private nodeMap: Map<string, GraphNode> = new Map();
  private edgeMap: Map<string, GraphEdge> = new Map();
  private fileToNodes: Map<string, string[]> = new Map(); // ファイルパス -> ノードIDの配列

  /**
   * 解析結果からグラフデータを生成
   */
  async extractGraphData(
    analyzer: TypeScriptAnalyzer,
    analysisResult: {
      files: any[];
      functions: FunctionInfo[];
      classes: ClassInfo[];
      imports: ImportInfo[];
      exports: ExportInfo[];
    },
    targetFile?: string,
    relatedFiles?: string[],
    relatedFunctions?: Array<{ name: string; filePath?: string }>,
    relatedClasses?: Array<{ name: string; filePath?: string }>,
    focusNodes?: string[]
  ): Promise<GraphData> {
    console.log(`[LLM-CodeMap] Starting graph data extraction...`);
    this.nodeMap.clear();
    this.edgeMap.clear();
    this.fileToNodes.clear();

    // 1. ファイルノードを作成
    for (const file of analysisResult.files) {
      this.createFileNode(file.path);
    }

    // 2. 関数ノードを作成
    for (const func of analysisResult.functions) {
      this.createFunctionNode(func);
    }

    // 3. クラスノードを作成
    for (const cls of analysisResult.classes) {
      this.createClassNode(cls);
    }

    // 4. メソッドノードを作成
    for (const cls of analysisResult.classes) {
      for (const method of cls.methods) {
        this.createMethodNode(method, cls);
      }
    }

    // 5. インポート/エクスポート関係のエッジを作成
    console.log(
      `[LLM-CodeMap] Creating import/export edges from ${analysisResult.imports.length} imports...`
    );
    for (const importInfo of analysisResult.imports) {
      this.createImportEdges(importInfo, analyzer);
    }
    console.log(`[LLM-CodeMap] Created ${this.edgeMap.size} edges so far`);

    // 6. 関数呼び出し関係のエッジを作成
    for (const file of analysisResult.files) {
      const sourceFile = analyzer.getSourceFile(file.path);
      if (sourceFile) {
        this.extractCallEdges(sourceFile, file.path, analyzer);
      }
    }

    // 7. クラス継承・実装関係のエッジを作成
    for (const cls of analysisResult.classes) {
      this.createInheritanceEdges(cls, analyzer);
    }

    // 8. 親子関係のエッジを作成（ファイルと関数/クラス/メソッドの間）
    this.createParentChildEdges();

    let result = {
      nodes: Array.from(this.nodeMap.values()),
      edges: Array.from(this.edgeMap.values()),
    };

    // LLMが指定したノードやファイルがある場合、フィルタリング
    if (targetFile || relatedFiles || relatedFunctions || relatedClasses || focusNodes) {
      result = this.filterGraphByLLMContext(
        result,
        analysisResult,
        targetFile,
        relatedFiles,
        relatedFunctions,
        relatedClasses,
        focusNodes
      );
      console.log(
        `[LLM-CodeMap] Filtered graph: ${result.nodes.length} nodes, ${result.edges.length} edges`
      );
    }

    console.log(
      `[LLM-CodeMap] Graph data extraction complete: ${result.nodes.length} nodes, ${result.edges.length} edges`
    );
    return result;
  }

  /**
   * LLMが提供したコンテキストに基づいてグラフをフィルタリング
   */
  private filterGraphByLLMContext(
    graphData: GraphData,
    analysisResult: {
      files: any[];
      functions: FunctionInfo[];
      classes: ClassInfo[];
      imports: ImportInfo[];
      exports: ExportInfo[];
    },
    targetFile?: string,
    relatedFiles?: string[],
    relatedFunctions?: Array<{ name: string; filePath?: string }>,
    relatedClasses?: Array<{ name: string; filePath?: string }>,
    focusNodes?: string[]
  ): GraphData {
    console.log(`[LLM-CodeMap] Filtering graph with LLM context...`);

    const relatedNodeIds = new Set<string>();

    // 1. focusNodesが指定されている場合、それを優先
    if (focusNodes && focusNodes.length > 0) {
      console.log(`[LLM-CodeMap] Using focusNodes: ${focusNodes.length} nodes`);
      for (const nodeId of focusNodes) {
        if (graphData.nodes.some((n) => n.id === nodeId)) {
          relatedNodeIds.add(nodeId);
        } else {
          console.warn(`[LLM-CodeMap] Focus node not found: ${nodeId}`);
        }
      }
    }

    // 2. targetFileが指定されている場合
    if (targetFile) {
      const targetFilePath = this.findTargetFilePath(targetFile, analysisResult.files);
      if (targetFilePath) {
        const targetFileNodeId = `file:${targetFilePath}`;
        relatedNodeIds.add(targetFileNodeId);
        console.log(`[LLM-CodeMap] Added target file: ${targetFilePath}`);
      }
    }

    // 3. relatedFilesが指定されている場合
    if (relatedFiles && relatedFiles.length > 0) {
      console.log(`[LLM-CodeMap] Processing ${relatedFiles.length} related files`);
      for (const file of relatedFiles) {
        const filePath = this.findTargetFilePath(file, analysisResult.files);
        if (filePath) {
          const fileNodeId = `file:${filePath}`;
          relatedNodeIds.add(fileNodeId);
          // ファイル内のすべてのノードも追加
          for (const node of graphData.nodes) {
            if (node.filePath === filePath) {
              relatedNodeIds.add(node.id);
            }
          }
        }
      }
    }

    // 4. relatedFunctionsが指定されている場合
    if (relatedFunctions && relatedFunctions.length > 0) {
      console.log(`[LLM-CodeMap] Processing ${relatedFunctions.length} related functions`);
      for (const func of relatedFunctions) {
        // ファイルパスが指定されている場合
        if (func.filePath) {
          const filePath = this.findTargetFilePath(func.filePath, analysisResult.files);
          if (filePath) {
            const funcNodeId = `function:${filePath}:${func.name}`;
            const fileNodeId = `file:${filePath}`;

            // 関数ノードが存在するか確認
            const funcNode = graphData.nodes.find((n) => n.id === funcNodeId);
            if (funcNode) {
              relatedNodeIds.add(funcNodeId);
              // ファイルノードも追加
              relatedNodeIds.add(fileNodeId);
              console.log(
                `[LLM-CodeMap] Added function node: ${funcNodeId} and file node: ${fileNodeId}`
              );
            } else {
              console.warn(`[LLM-CodeMap] Function node not found: ${funcNodeId}`);
            }
          }
        } else {
          // ファイルパスが指定されていない場合、名前で検索
          for (const analysisFunc of analysisResult.functions) {
            if (analysisFunc.name === func.name) {
              const funcNodeId = `function:${analysisFunc.filePath}:${analysisFunc.name}`;
              const fileNodeId = `file:${analysisFunc.filePath}`;
              relatedNodeIds.add(funcNodeId);
              relatedNodeIds.add(fileNodeId);
              console.log(
                `[LLM-CodeMap] Added function node: ${funcNodeId} and file node: ${fileNodeId}`
              );
            }
          }
        }
      }
    }

    // 5. relatedClassesが指定されている場合
    if (relatedClasses && relatedClasses.length > 0) {
      console.log(`[LLM-CodeMap] Processing ${relatedClasses.length} related classes`);
      for (const cls of relatedClasses) {
        // ファイルパスが指定されている場合
        if (cls.filePath) {
          const filePath = this.findTargetFilePath(cls.filePath, analysisResult.files);
          if (filePath) {
            const classNodeId = `class:${filePath}:${cls.name}`;
            if (graphData.nodes.some((n) => n.id === classNodeId)) {
              relatedNodeIds.add(classNodeId);
              // ファイルノードも追加
              relatedNodeIds.add(`file:${filePath}`);
              // クラス内のメソッドも追加
              for (const analysisClass of analysisResult.classes) {
                if (analysisClass.filePath === filePath && analysisClass.name === cls.name) {
                  for (const method of analysisClass.methods) {
                    relatedNodeIds.add(`method:${method.filePath}:${cls.name}.${method.name}`);
                  }
                }
              }
            }
          }
        } else {
          // ファイルパスが指定されていない場合、名前で検索
          for (const analysisClass of analysisResult.classes) {
            if (analysisClass.name === cls.name) {
              const classNodeId = `class:${analysisClass.filePath}:${analysisClass.name}`;
              relatedNodeIds.add(classNodeId);
              relatedNodeIds.add(`file:${analysisClass.filePath}`);
              // クラス内のメソッドも追加
              for (const method of analysisClass.methods) {
                relatedNodeIds.add(`method:${method.filePath}:${cls.name}.${method.name}`);
              }
            }
          }
        }
      }
    }

    // 6. 幅優先探索で関連ノードを収集（既存のロジックを使用）
    if (relatedNodeIds.size > 0) {
      const nodesToProcess = new Set<string>(relatedNodeIds);
      const processedNodes = new Set<string>();

      while (nodesToProcess.size > 0) {
        const currentNodeId = Array.from(nodesToProcess)[0];
        nodesToProcess.delete(currentNodeId);

        if (processedNodes.has(currentNodeId)) {
          continue;
        }

        processedNodes.add(currentNodeId);
        relatedNodeIds.add(currentNodeId);

        // このノードから出るエッジを探す
        for (const edge of graphData.edges) {
          if (edge.source === currentNodeId) {
            if (!processedNodes.has(edge.target)) {
              nodesToProcess.add(edge.target);
              relatedNodeIds.add(edge.target);

              // ターゲットノードのファイルも追加
              const targetNode = graphData.nodes.find((n) => n.id === edge.target);
              if (targetNode) {
                const targetFileNodeId = `file:${targetNode.filePath}`;
                if (!processedNodes.has(targetFileNodeId)) {
                  nodesToProcess.add(targetFileNodeId);
                }
              }
            }
          }

          // このノードへのエッジを探す
          if (edge.target === currentNodeId) {
            if (!processedNodes.has(edge.source)) {
              nodesToProcess.add(edge.source);
              relatedNodeIds.add(edge.source);

              // ソースノードのファイルも追加
              const sourceNode = graphData.nodes.find((n) => n.id === edge.source);
              if (sourceNode) {
                const sourceFileNodeId = `file:${sourceNode.filePath}`;
                if (!processedNodes.has(sourceFileNodeId)) {
                  nodesToProcess.add(sourceFileNodeId);
                }
              }
            }
          }
        }

        // 親ノードも追加
        const currentNode = graphData.nodes.find((n) => n.id === currentNodeId);
        if (currentNode && currentNode.parentId && !processedNodes.has(currentNode.parentId)) {
          nodesToProcess.add(currentNode.parentId);
        }
      }

      // ファイルノードに関連するすべての子ノードも追加
      for (const nodeId of Array.from(relatedNodeIds)) {
        const node = graphData.nodes.find((n) => n.id === nodeId);
        if (node && node.type === NodeType.File) {
          for (const childNode of graphData.nodes) {
            if (childNode.filePath === node.filePath && childNode.id !== nodeId) {
              relatedNodeIds.add(childNode.id);
            }
          }
        }
      }
    }

    // 7. ノードとエッジをフィルタリング
    const filteredNodes = graphData.nodes.filter((n) => relatedNodeIds.has(n.id));
    const filteredEdges = graphData.edges.filter((e) => {
      const sourceIncluded = relatedNodeIds.has(e.source);
      const targetIncluded = relatedNodeIds.has(e.target);
      if (!sourceIncluded || !targetIncluded) {
        if (e.type === EdgeType.Reference && e.label === 'contains') {
          console.log(
            `[LLM-CodeMap] Filtering out parent-child edge: ${e.source} -> ${e.target} (source: ${sourceIncluded}, target: ${targetIncluded})`
          );
        }
        return false;
      }
      return true;
    });

    console.log(
      `[LLM-CodeMap] Filtered graph: ${filteredNodes.length} nodes, ${filteredEdges.length} edges`
    );
    console.log(`[LLM-CodeMap] Total edges before filtering: ${graphData.edges.length}`);
    console.log(
      `[LLM-CodeMap] Related node IDs: ${Array.from(relatedNodeIds).slice(0, 10).join(', ')}${relatedNodeIds.size > 10 ? '...' : ''}`
    );

    // デバッグ: 親子関係のエッジが含まれているか確認
    const allParentChildEdges = graphData.edges.filter(
      (e) => e.type === EdgeType.Reference && e.label === 'contains'
    );
    const parentChildEdges = filteredEdges.filter(
      (e) => e.type === EdgeType.Reference && e.label === 'contains'
    );
    console.log(
      `[LLM-CodeMap] Parent-child edges: ${allParentChildEdges.length} total, ${parentChildEdges.length} in filtered graph`
    );

    // エッジタイプ別の統計
    const edgeTypeStats: { [key: string]: number } = {};
    filteredEdges.forEach((e) => {
      edgeTypeStats[e.type] = (edgeTypeStats[e.type] || 0) + 1;
    });
    console.log(`[LLM-CodeMap] Edge type distribution in filtered graph:`, edgeTypeStats);

    return {
      nodes: filteredNodes,
      edges: filteredEdges,
    };
  }

  /**
   * ターゲットファイルのパスを検索
   */
  private findTargetFilePath(targetFile: string, files: { path: string }[]): string | undefined {
    // 絶対パスの場合
    if (path.isAbsolute(targetFile)) {
      return files.find((f) => f.path === targetFile)?.path;
    }

    // ファイル名のみの場合
    const fileName = path.basename(targetFile);
    const matchingFiles = files.filter(
      (f) => path.basename(f.path) === fileName || f.path.endsWith(targetFile)
    );

    if (matchingFiles.length === 1) {
      return matchingFiles[0].path;
    }

    // 複数マッチする場合は、最も短いパスを返す（通常はルートに近い）
    if (matchingFiles.length > 1) {
      matchingFiles.sort((a, b) => a.path.length - b.path.length);
      return matchingFiles[0].path;
    }

    // 相対パスの場合
    for (const file of files) {
      if (file.path.endsWith(targetFile) || file.path.includes(targetFile)) {
        return file.path;
      }
    }

    return undefined;
  }

  /**
   * ファイルノードを作成
   */
  private createFileNode(filePath: string): void {
    const nodeId = `file:${filePath}`;
    const fileName = path.basename(filePath);

    if (!this.nodeMap.has(nodeId)) {
      const node: GraphNode = {
        id: nodeId,
        label: fileName,
        type: NodeType.File,
        filePath,
        metadata: {
          fullPath: filePath,
        },
      };
      this.nodeMap.set(nodeId, node);

      // ファイルとノードのマッピングを更新
      if (!this.fileToNodes.has(filePath)) {
        this.fileToNodes.set(filePath, []);
      }
      this.fileToNodes.get(filePath)!.push(nodeId);
    }
  }

  /**
   * 関数ノードを作成
   */
  private createFunctionNode(func: FunctionInfo): void {
    const nodeId = `function:${func.filePath}:${func.name}`;
    const fileNodeId = `file:${func.filePath}`;

    if (!this.nodeMap.has(nodeId)) {
      const node: GraphNode = {
        id: nodeId,
        label: func.name,
        type: NodeType.Function,
        filePath: func.filePath,
        line: func.line,
        column: func.column,
        parentId: fileNodeId,
        metadata: {
          isExported: func.isExported,
          isAsync: func.isAsync,
          parameters: func.parameters,
          returnType: func.returnType,
        },
      };
      this.nodeMap.set(nodeId, node);

      // ファイルとノードのマッピングを更新
      if (!this.fileToNodes.has(func.filePath)) {
        this.fileToNodes.set(func.filePath, []);
      }
      this.fileToNodes.get(func.filePath)!.push(nodeId);
    }
  }

  /**
   * クラスノードを作成
   */
  private createClassNode(cls: ClassInfo): void {
    const nodeId = `class:${cls.filePath}:${cls.name}`;
    const fileNodeId = `file:${cls.filePath}`;

    if (!this.nodeMap.has(nodeId)) {
      const node: GraphNode = {
        id: nodeId,
        label: cls.name,
        type: NodeType.Class,
        filePath: cls.filePath,
        line: cls.line,
        column: cls.column,
        parentId: fileNodeId,
        metadata: {
          isExported: cls.isExported,
          extends: cls.extends,
          implements: cls.implements,
        },
      };
      this.nodeMap.set(nodeId, node);

      // ファイルとノードのマッピングを更新
      if (!this.fileToNodes.has(cls.filePath)) {
        this.fileToNodes.set(cls.filePath, []);
      }
      this.fileToNodes.get(cls.filePath)!.push(nodeId);
    }
  }

  /**
   * メソッドノードを作成
   */
  private createMethodNode(method: any, cls: ClassInfo): void {
    const nodeId = `method:${method.filePath}:${cls.name}.${method.name}`;
    const classNodeId = `class:${method.filePath}:${cls.name}`;

    if (!this.nodeMap.has(nodeId)) {
      const node: GraphNode = {
        id: nodeId,
        label: `${cls.name}.${method.name}`,
        type: NodeType.Method,
        filePath: method.filePath,
        line: method.line,
        column: method.column,
        parentId: classNodeId,
        metadata: {
          isPublic: method.isPublic,
          isStatic: method.isStatic,
          isAsync: method.isAsync,
          parameters: method.parameters,
          returnType: method.returnType,
        },
      };
      this.nodeMap.set(nodeId, node);
    }
  }

  /**
   * インポート関係のエッジを作成
   */
  private createImportEdges(importInfo: ImportInfo, analyzer: TypeScriptAnalyzer): void {
    // インポート元ファイルのノードを取得
    const sourceFileNodes = this.fileToNodes.get(importInfo.from) || [];
    if (sourceFileNodes.length === 0) {
      // インポート元ファイルが見つからない場合、ファイルノードを作成してみる
      if (!this.nodeMap.has(`file:${importInfo.from}`)) {
        this.createFileNode(importInfo.from);
        const newSourceFileNodes = this.fileToNodes.get(importInfo.from) || [];
        if (newSourceFileNodes.length > 0) {
          sourceFileNodes.push(...newSourceFileNodes);
        }
      }
    }

    if (sourceFileNodes.length === 0) {
      return;
    }

    // 各インポートされた要素に対してエッジを作成
    for (const importName of importInfo.imports) {
      // ターゲットファイル内で該当する要素を探す
      const targetFile = this.findFileByExport(importName, analyzer);
      if (targetFile) {
        // ターゲットファイルのノードが存在しない場合は作成
        if (!this.fileToNodes.has(targetFile)) {
          this.createFileNode(targetFile);
        }
        const targetNodes = this.fileToNodes.get(targetFile) || [];

        // ファイルノード間のエッジを作成（より確実な方法）
        const sourceFileNodeId = sourceFileNodes[0]; // ファイルノードを使用
        const targetFileNodeId = `file:${targetFile}`;

        // ファイルノードが存在することを確認
        if (this.nodeMap.has(sourceFileNodeId) && this.nodeMap.has(targetFileNodeId)) {
          const edgeId = `import:${sourceFileNodeId}:${targetFileNodeId}`;
          if (!this.edgeMap.has(edgeId)) {
            const edge: GraphEdge = {
              id: edgeId,
              source: sourceFileNodeId,
              target: targetFileNodeId,
              type: EdgeType.Import,
              label: importName,
              metadata: {
                isDefault: importInfo.isDefault,
                isNamespace: importInfo.isNamespace,
              },
            };
            this.edgeMap.set(edgeId, edge);
          }
        }

        // 特定の要素（関数、クラスなど）へのエッジも作成
        for (const sourceNodeId of sourceFileNodes) {
          for (const targetNodeId of targetNodes) {
            const targetNode = this.nodeMap.get(targetNodeId);
            if (targetNode && targetNode.label === importName) {
              const edgeId = `import:${sourceNodeId}:${targetNodeId}`;
              if (!this.edgeMap.has(edgeId)) {
                const edge: GraphEdge = {
                  id: edgeId,
                  source: sourceNodeId,
                  target: targetNodeId,
                  type: EdgeType.Import,
                  label: importName,
                  metadata: {
                    isDefault: importInfo.isDefault,
                    isNamespace: importInfo.isNamespace,
                  },
                };
                this.edgeMap.set(edgeId, edge);
              }
            }
          }
        }
      } else {
        // ターゲットファイルが見つからない場合でも、インポート元ファイルのノードは追加
        // （相対パスの解決に失敗している可能性がある）
        console.warn(
          `[LLM-CodeMap] Could not find target file for import: ${importName} from ${importInfo.from}`
        );
      }
    }
  }

  /**
   * 関数呼び出し関係のエッジを抽出
   */
  private extractCallEdges(
    sourceFile: ts.SourceFile,
    filePath: string,
    analyzer: TypeScriptAnalyzer
  ): void {
    const visit = (node: ts.Node) => {
      // 関数呼び出しを検出
      if (ts.isCallExpression(node)) {
        const expression = node.expression;
        let functionName: string | undefined;

        if (ts.isIdentifier(expression) && expression.text) {
          functionName = expression.text;
        } else if (ts.isPropertyAccessExpression(expression)) {
          // obj.method() の形式
          if (ts.isIdentifier(expression.name) && expression.name.text) {
            functionName = expression.name.text;
          }
        }

        if (functionName) {
          // このファイル内の関数ノードを探す
          const fileNodes = this.fileToNodes.get(filePath) || [];
          for (const nodeId of fileNodes) {
            const node = this.nodeMap.get(nodeId);
            if (node && (node.label === functionName || node.metadata?.name === functionName)) {
              // 呼び出し元の関数を探す（現在のスコープ内）
              const callerNodeId = this.findCallerNode(node, sourceFile);
              if (callerNodeId) {
                const edgeId = `call:${callerNodeId}:${nodeId}`;
                if (!this.edgeMap.has(edgeId)) {
                  const edge: GraphEdge = {
                    id: edgeId,
                    source: callerNodeId,
                    target: nodeId,
                    type: EdgeType.Call,
                    label: 'calls',
                  };
                  this.edgeMap.set(edgeId, edge);
                }
              }
            }
          }
        }
      }

      ts.forEachChild(node, visit);
    };

    visit(sourceFile);
  }

  /**
   * 呼び出し元ノードを探す
   */
  private findCallerNode(callNode: GraphNode, sourceFile: ts.SourceFile): string | undefined {
    // 簡易実装: ファイル内の関数ノードを返す
    // より正確な実装には、ASTを再走査して呼び出し元の関数を特定する必要がある
    const fileNodes = this.fileToNodes.get(callNode.filePath) || [];
    for (const nodeId of fileNodes) {
      const node = this.nodeMap.get(nodeId);
      if (node && node.type === NodeType.Function) {
        return nodeId;
      }
    }
    return undefined;
  }

  /**
   * 親クラスを探す
   */
  private findParentClass(node: ts.Node): ts.ClassDeclaration | undefined {
    let current: ts.Node | undefined = node.parent;
    while (current) {
      if (ts.isClassDeclaration(current)) {
        return current;
      }
      current = current.parent;
    }
    return undefined;
  }

  /**
   * クラス継承・実装関係のエッジを作成
   */
  private createInheritanceEdges(cls: ClassInfo, analyzer: TypeScriptAnalyzer): void {
    const classNodeId = `class:${cls.filePath}:${cls.name}`;

    // extends関係
    if (cls.extends) {
      const extendsNodeId = this.findNodeByName(cls.extends, NodeType.Class);
      if (extendsNodeId) {
        const edgeId = `extends:${classNodeId}:${extendsNodeId}`;
        if (!this.edgeMap.has(edgeId)) {
          const edge: GraphEdge = {
            id: edgeId,
            source: classNodeId,
            target: extendsNodeId,
            type: EdgeType.Extends,
            label: 'extends',
          };
          this.edgeMap.set(edgeId, edge);
        }
      }
    }

    // implements関係
    for (const interfaceName of cls.implements) {
      const implementsNodeId = this.findNodeByName(interfaceName, NodeType.Interface);
      if (implementsNodeId) {
        const edgeId = `implements:${classNodeId}:${implementsNodeId}`;
        if (!this.edgeMap.has(edgeId)) {
          const edge: GraphEdge = {
            id: edgeId,
            source: classNodeId,
            target: implementsNodeId,
            type: EdgeType.Implements,
            label: 'implements',
          };
          this.edgeMap.set(edgeId, edge);
        }
      }
    }
  }

  /**
   * 親子関係のエッジを作成（ファイルと関数/クラス/メソッドの間）
   */
  private createParentChildEdges(): void {
    console.log(`[LLM-CodeMap] Creating parent-child edges...`);
    let edgeCount = 0;
    let skippedCount = 0;

    for (const [nodeId, node] of this.nodeMap.entries()) {
      // parentIdが設定されている場合、親ノードへのエッジを作成
      if (node.parentId) {
        if (this.nodeMap.has(node.parentId)) {
          const edgeId = `parent:${node.parentId}:${nodeId}`;
          if (!this.edgeMap.has(edgeId)) {
            const edge: GraphEdge = {
              id: edgeId,
              source: node.parentId,
              target: nodeId,
              type: EdgeType.Reference,
              label: 'contains',
              metadata: {
                relationship: 'parent-child',
              },
            };
            this.edgeMap.set(edgeId, edge);
            edgeCount++;

            // 最初の数個のエッジをログ出力
            if (edgeCount <= 5) {
              console.log(
                `[LLM-CodeMap] Created parent-child edge: ${node.parentId} -> ${nodeId} (${node.type})`
              );
            }
          }
        } else {
          skippedCount++;
          if (skippedCount <= 5) {
            console.warn(
              `[LLM-CodeMap] Parent node not found: ${node.parentId} for node ${nodeId}`
            );
          }
        }
      }
    }

    console.log(
      `[LLM-CodeMap] Created ${edgeCount} parent-child edges (skipped ${skippedCount} due to missing parent)`
    );
  }

  /**
   * LLMが指定したノードとエッジからグラフを作成（簡略化された方法）
   */
  createGraphFromLLMSpec(
    nodes: Array<{
      id: string;
      label: string;
      type: 'file' | 'function' | 'class' | 'method' | 'interface' | 'type' | 'variable';
      filePath?: string;
      line?: number;
      column?: number;
    }>,
    edges: Array<{
      source: string;
      target: string;
      type: 'import' | 'export' | 'call' | 'extends' | 'implements' | 'reference';
      label?: string;
    }>
  ): GraphData {
    console.log(
      `[LLM-CodeMap] Creating graph from LLM specification: ${nodes.length} nodes, ${edges.length} edges`
    );

    const graphNodes: GraphNode[] = nodes.map((n) => {
      // ノードタイプをenumに変換
      let nodeType: NodeType;
      switch (n.type) {
        case 'file':
          nodeType = NodeType.File;
          break;
        case 'function':
          nodeType = NodeType.Function;
          break;
        case 'class':
          nodeType = NodeType.Class;
          break;
        case 'method':
          nodeType = NodeType.Method;
          break;
        case 'interface':
          nodeType = NodeType.Interface;
          break;
        case 'type':
          nodeType = NodeType.Type;
          break;
        case 'variable':
          nodeType = NodeType.Variable;
          break;
        default:
          nodeType = NodeType.File;
      }

      return {
        id: n.id,
        label: n.label,
        type: nodeType,
        filePath:
          n.filePath || n.id.replace(/^(file|function|class|method):/, '').split(':')[0] || '',
        line: n.line,
        column: n.column,
        metadata: {},
      };
    });

    const graphEdges: GraphEdge[] = edges.map((e, index) => {
      // エッジタイプをenumに変換
      let edgeType: EdgeType;
      switch (e.type) {
        case 'import':
          edgeType = EdgeType.Import;
          break;
        case 'export':
          edgeType = EdgeType.Export;
          break;
        case 'call':
          edgeType = EdgeType.Call;
          break;
        case 'extends':
          edgeType = EdgeType.Extends;
          break;
        case 'implements':
          edgeType = EdgeType.Implements;
          break;
        case 'reference':
          edgeType = EdgeType.Reference;
          break;
        default:
          edgeType = EdgeType.Reference;
      }

      // ソースとターゲットのノードが存在するか確認
      const sourceExists = graphNodes.some((n) => n.id === e.source);
      const targetExists = graphNodes.some((n) => n.id === e.target);

      if (!sourceExists) {
        console.warn(`[LLM-CodeMap] Edge ${index}: Source node not found: ${e.source}`);
        console.warn(
          `[LLM-CodeMap] Available node IDs: ${graphNodes
            .slice(0, 5)
            .map((n) => n.id)
            .join(', ')}...`
        );
      }
      if (!targetExists) {
        console.warn(`[LLM-CodeMap] Edge ${index}: Target node not found: ${e.target}`);
        console.warn(
          `[LLM-CodeMap] Available node IDs: ${graphNodes
            .slice(0, 5)
            .map((n) => n.id)
            .join(', ')}...`
        );
      }

      return {
        id: `edge-${index}`,
        source: e.source,
        target: e.target,
        type: edgeType,
        label: e.label || 'contains',
        metadata: {},
      };
    });

    console.log(
      `[LLM-CodeMap] Created graph: ${graphNodes.length} nodes, ${graphEdges.length} edges`
    );

    // デバッグ: 最初の数個のエッジをログ出力
    if (graphEdges.length > 0) {
      console.log(
        `[LLM-CodeMap] Sample edges:`,
        graphEdges.slice(0, 3).map((e) => ({
          source: e.source,
          target: e.target,
          type: e.type,
          label: e.label,
        }))
      );
    }

    return {
      nodes: graphNodes,
      edges: graphEdges,
    };
  }

  /**
   * 名前でノードを検索
   */
  private findNodeByName(name: string, type: NodeType): string | undefined {
    for (const [nodeId, node] of this.nodeMap.entries()) {
      if (node.label === name && node.type === type) {
        return nodeId;
      }
    }
    return undefined;
  }

  /**
   * エクスポートでファイルを検索
   */
  private findFileByExport(exportName: string, analyzer: TypeScriptAnalyzer): string | undefined {
    // 簡易実装: すべてのファイルノードをチェック
    for (const [nodeId, node] of this.nodeMap.entries()) {
      if (node.type === NodeType.File && node.label === exportName) {
        return node.filePath;
      }
      if (
        node.label === exportName &&
        (node.type === NodeType.Function || node.type === NodeType.Class)
      ) {
        return node.filePath;
      }
    }
    return undefined;
  }
}
