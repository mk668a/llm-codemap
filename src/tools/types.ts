/**
 * Language Model Toolの型定義
 */

/**
 * codemapツールの入力パラメータ
 */
export interface ICodemapParameters {
  workspacePath?: string;
  filePattern?: string;
  depth?: number;
  targetFile?: string; // 特定のファイルを中心に可視化する場合のファイルパス（相対パスまたはファイル名）
  relatedFiles?: string[]; // LLMが解析した関連ファイルのリスト（ファイルパスまたはファイル名）
  relatedFunctions?: Array<{
    name: string;
    filePath?: string;
  }>; // LLMが解析した関連関数のリスト
  relatedClasses?: Array<{
    name: string;
    filePath?: string;
  }>; // LLMが解析した関連クラスのリスト
  focusNodes?: string[]; // フォーカスするノードIDのリスト（LLMが解析した結果から生成）
  nodes?: Array<{
    id: string;
    label: string;
    type: 'file' | 'function' | 'class' | 'method' | 'interface' | 'type' | 'variable';
    filePath?: string;
    line?: number;
    column?: number;
  }>; // LLMが直接指定するノードのリスト（推奨）
  edges?: Array<{
    source: string;
    target: string;
    type: 'import' | 'export' | 'call' | 'extends' | 'implements' | 'reference';
    label?: string;
  }>; // LLMが直接指定するエッジ（依存関係）のリスト（推奨）
}
