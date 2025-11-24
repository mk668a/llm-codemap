import * as vscode from 'vscode';
import { CodemapViewProvider } from './visualizer/CodemapViewProvider';
import { CodemapTool } from './tools/codemapTool';
import { TypeScriptAnalyzer } from './analyzer/TypeScriptAnalyzer';
import { DependencyExtractor } from './analyzer/DependencyExtractor';

/**
 * 拡張機能のアクティベート
 */
export function activate(context: vscode.ExtensionContext) {
  console.log('LLM Code Map extension is now active!');

  // アナライザーとエクストラクターのインスタンスを作成
  const analyzer = new TypeScriptAnalyzer();
  const extractor = new DependencyExtractor();

  // WebviewViewプロバイダーを登録
  const provider = new CodemapViewProvider(context.extensionUri);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider(CodemapViewProvider.viewType, provider)
  );

  // リフレッシュコマンド
  context.subscriptions.push(
    vscode.commands.registerCommand('codemap.refresh', async () => {
      const workspacePath = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

      if (!workspacePath) {
        vscode.window.showWarningMessage('Please open a workspace first.');
        return;
      }

      try {
        console.log(`[LLM-CodeMap] Starting analysis for workspace: ${workspacePath}`);
        vscode.window.setStatusBarMessage('Analyzing code...', 1000);

        // コード解析
        const analysisResult = await analyzer.analyzeWorkspace(workspacePath);
        console.log(
          `[LLM-CodeMap] Analysis result: ${analysisResult.files.length} files, ${analysisResult.functions.length} functions, ${analysisResult.classes.length} classes`
        );

        // 依存関係抽出
        vscode.window.setStatusBarMessage('Extracting dependencies...', 1000);
        console.log(`[LLM-CodeMap] Extracting dependencies...`);
        const graphData = await extractor.extractGraphData(analyzer, analysisResult, undefined);
        console.log(
          `[LLM-CodeMap] Graph data extracted: ${graphData.nodes.length} nodes, ${graphData.edges.length} edges`
        );

        // グラフを更新
        provider.updateGraph(graphData);
        console.log(`[LLM-CodeMap] Graph updated in webview`);

        vscode.window.setStatusBarMessage(
          `Code map updated: ${graphData.nodes.length} nodes, ${graphData.edges.length} edges`,
          3000
        );
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        console.error(`[LLM-CodeMap] Error: ${errorMessage}`, error);
        vscode.window.showErrorMessage(`Failed to refresh code map: ${errorMessage}`);
      }
    })
  );

  // Language Model Toolを登録
  const codemapTool = new CodemapTool(provider, analyzer, extractor);
  context.subscriptions.push(vscode.lm.registerTool('codemap_analyze', codemapTool));
}

/**
 * 拡張機能のデアクティベート
 */
export function deactivate() {
  console.log('LLM Code Map extension is now deactivated!');
}
