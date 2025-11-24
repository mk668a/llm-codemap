import * as path from 'path';
import * as vscode from 'vscode';

/**
 * パス操作ユーティリティ
 */

/**
 * パスを正規化（相対パスを絶対パスに変換）
 */
export function normalizePath(filePath: string, basePath?: string): string {
  if (path.isAbsolute(filePath)) {
    return path.normalize(filePath);
  }
  if (basePath) {
    return path.normalize(path.resolve(basePath, filePath));
  }
  return path.normalize(filePath);
}

/**
 * ワークスペースルートからの相対パスを取得
 */
export function getRelativePath(
  filePath: string,
  workspaceFolder?: vscode.WorkspaceFolder
): string {
  const workspacePath = workspaceFolder?.uri.fsPath;
  if (workspacePath && filePath.startsWith(workspacePath)) {
    return path.relative(workspacePath, filePath);
  }
  return filePath;
}

/**
 * 2つのパス間の相対パスを計算
 */
export function getRelativePathBetween(from: string, to: string): string {
  return path.relative(path.dirname(from), to);
}

/**
 * パスをURIに変換
 */
export function pathToUri(filePath: string): vscode.Uri {
  return vscode.Uri.file(filePath);
}

/**
 * URIをパスに変換
 */
export function uriToPath(uri: vscode.Uri): string {
  return uri.fsPath;
}

/**
 * パスを正規化して比較
 */
export function pathsEqual(path1: string, path2: string): boolean {
  return path.normalize(path1) === path.normalize(path2);
}

/**
 * ファイル名（拡張子なし）を取得
 */
export function getFileNameWithoutExtension(filePath: string): string {
  return path.basename(filePath, path.extname(filePath));
}

/**
 * ディレクトリパスを取得
 */
export function getDirectoryPath(filePath: string): string {
  return path.dirname(filePath);
}
