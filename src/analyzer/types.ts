/**
 * コード解析結果の型定義
 */

/**
 * グラフノードの種類
 */
export enum NodeType {
  File = 'file',
  Function = 'function',
  Class = 'class',
  Method = 'method',
  Interface = 'interface',
  Type = 'type',
  Variable = 'variable',
}

/**
 * エッジの種類（依存関係の種類）
 */
export enum EdgeType {
  Import = 'import',
  Export = 'export',
  Call = 'call',
  Extends = 'extends',
  Implements = 'implements',
  Reference = 'reference',
}

/**
 * グラフノード
 */
export interface GraphNode {
  id: string;
  label: string;
  type: NodeType;
  filePath: string;
  line?: number;
  column?: number;
  parentId?: string; // 親ノードのID（例: 関数が属するファイル）
  metadata?: {
    [key: string]: any;
  };
}

/**
 * グラフエッジ（依存関係）
 */
export interface GraphEdge {
  id: string;
  source: string; // ソースノードのID
  target: string; // ターゲットノードのID
  type: EdgeType;
  label?: string;
  metadata?: {
    [key: string]: any;
  };
}

/**
 * グラフデータ
 */
export interface GraphData {
  nodes: GraphNode[];
  edges: GraphEdge[];
}

/**
 * ファイル情報
 */
export interface FileInfo {
  path: string;
  content: string;
  sourceFile?: any; // TypeScript SourceFile
}

/**
 * 関数情報
 */
export interface FunctionInfo {
  name: string;
  filePath: string;
  line: number;
  column: number;
  isExported: boolean;
  isAsync: boolean;
  parameters: string[];
  returnType?: string;
}

/**
 * クラス情報
 */
export interface ClassInfo {
  name: string;
  filePath: string;
  line: number;
  column: number;
  isExported: boolean;
  extends?: string;
  implements: string[];
  methods: MethodInfo[];
  properties: PropertyInfo[];
}

/**
 * メソッド情報
 */
export interface MethodInfo {
  name: string;
  filePath: string;
  line: number;
  column: number;
  isPublic: boolean;
  isStatic: boolean;
  isAsync: boolean;
  parameters: string[];
  returnType?: string;
}

/**
 * プロパティ情報
 */
export interface PropertyInfo {
  name: string;
  filePath: string;
  line: number;
  column: number;
  type?: string;
  isPublic: boolean;
  isStatic: boolean;
}

/**
 * インポート情報
 */
export interface ImportInfo {
  from: string; // インポート元のファイルパス
  imports: string[]; // インポートされた名前
  isDefault: boolean;
  isNamespace: boolean;
}

/**
 * エクスポート情報
 */
export interface ExportInfo {
  name: string;
  type: 'default' | 'named' | 'namespace';
  filePath: string;
  line: number;
  column: number;
}
