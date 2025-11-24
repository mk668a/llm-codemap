import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';

/**
 * ファイル操作ユーティリティ
 */

/**
 * ワークスペース内のファイルを検索
 */
export async function findFiles(pattern: string, exclude?: string): Promise<vscode.Uri[]> {
  const defaultExclude = [
    '**/node_modules/**',
    '**/.git/**',
    '**/dist/**',
    '**/build/**',
    '**/.next/**',
    '**/out/**',
    '**/coverage/**',
    '**/.cache/**',
    '**/tmp/**',
    '**/temp/**',
    '**/*.min.js',
    '**/*.bundle.js',
  ].join(',');
  const excludePattern = exclude || defaultExclude;
  return await vscode.workspace.findFiles(pattern, excludePattern);
}

/**
 * ファイルの内容を読み込む
 */
export async function readFileContent(uri: vscode.Uri): Promise<string> {
  const bytes = await vscode.workspace.fs.readFile(uri);
  return Buffer.from(bytes).toString('utf-8');
}

/**
 * ファイルが存在するかチェック
 */
export function fileExists(filePath: string): boolean {
  try {
    return fs.statSync(filePath).isFile();
  } catch {
    return false;
  }
}

/**
 * ディレクトリが存在するかチェック
 */
export function directoryExists(dirPath: string): boolean {
  try {
    return fs.statSync(dirPath).isDirectory();
  } catch {
    return false;
  }
}

/**
 * ファイルの拡張子を取得
 */
export function getFileExtension(filePath: string): string {
  return path.extname(filePath).toLowerCase();
}

/**
 * TypeScript/JavaScriptファイルかどうかチェック
 */
export function isTypeScriptOrJavaScriptFile(filePath: string): boolean {
  const ext = getFileExtension(filePath);
  return ext === '.ts' || ext === '.tsx' || ext === '.js' || ext === '.jsx';
}

/**
 * ファイルパスが除外対象かどうかチェック
 */
export function shouldExcludeFile(filePath: string): boolean {
  const normalizedPath = filePath.replace(/\\/g, '/').toLowerCase();

  // 主要な除外パターン（ビルド成果物、依存関係、キャッシュなど）
  const excludePatterns = [
    '/node_modules/',
    '/.git/',
    '/dist/',
    '/build/',
    '/.next/',
    '/out/',
    '/coverage/',
    '/.cache/',
    '/tmp/',
    '/temp/',
    '/.vscode/',
    '/.idea/',
    '/.vs/',
    '/.turbo/',
    '/.swc/',
    '/.parcel-cache/',
    '/.yarn/',
    '/.pnp/',
    '/.expo/',
    '/ios/build/',
    '/android/build/',
    '/storybook-static/',
    '/.docusaurus/',
    '/.umi-production/',
    '/.umi-test/',
    '/.min.js',
    '/.bundle.js',
    '/.chunk.js',
    '/.map',
  ];

  return excludePatterns.some((pattern) => normalizedPath.includes(pattern));
}

/**
 * 再帰的にディレクトリ内のファイルを取得
 */
export function getFilesRecursively(dirPath: string, pattern?: RegExp): string[] {
  const files: string[] = [];

  if (!directoryExists(dirPath)) {
    return files;
  }

  const entries = fs.readdirSync(dirPath, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dirPath, entry.name);

    if (entry.isDirectory()) {
      // node_modulesや.gitをスキップ
      if (entry.name === 'node_modules' || entry.name === '.git') {
        continue;
      }
      files.push(...getFilesRecursively(fullPath, pattern));
    } else if (entry.isFile()) {
      if (!pattern || pattern.test(fullPath)) {
        files.push(fullPath);
      }
    }
  }

  return files;
}
