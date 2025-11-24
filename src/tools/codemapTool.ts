import * as vscode from 'vscode';
import { ICodemapParameters } from './types';
import { CodemapViewProvider } from '../visualizer/CodemapViewProvider';
import { TypeScriptAnalyzer } from '../analyzer/TypeScriptAnalyzer';
import { DependencyExtractor } from '../analyzer/DependencyExtractor';

/**
 * LLM Code Map Language Model Tool
 */
export class CodemapTool implements vscode.LanguageModelTool<ICodemapParameters> {
  constructor(
    private readonly _viewProvider: CodemapViewProvider,
    private readonly _analyzer: TypeScriptAnalyzer,
    private readonly _extractor: DependencyExtractor
  ) {}

  async prepareInvocation(
    options: vscode.LanguageModelToolInvocationPrepareOptions<ICodemapParameters>,
    _token: vscode.CancellationToken
  ) {
    const params = options.input;
    const workspacePath =
      params.workspacePath || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

    const focusItems: string[] = [];
    if (params.nodes && params.nodes.length > 0) {
      focusItems.push(`**${params.nodes.length} nodes** (direct specification)`);
    }
    if (params.edges && params.edges.length > 0) {
      focusItems.push(`**${params.edges.length} edges** (direct specification)`);
    }
    if (params.targetFile) {
      focusItems.push(`**Primary file**: \`${params.targetFile}\``);
    }
    if (params.relatedFiles && params.relatedFiles.length > 0) {
      const fileList = params.relatedFiles
        .slice(0, 5)
        .map((f) => `\`${f}\``)
        .join(', ');
      const moreFiles =
        params.relatedFiles.length > 5 ? ` and ${params.relatedFiles.length - 5} more` : '';
      focusItems.push(`**${params.relatedFiles.length} related files**: ${fileList}${moreFiles}`);
    }
    if (params.relatedFunctions && params.relatedFunctions.length > 0) {
      const funcList = params.relatedFunctions
        .slice(0, 3)
        .map((f) => `\`${f.name}\`` + (f.filePath ? ` (${f.filePath})` : ''))
        .join(', ');
      const moreFuncs =
        params.relatedFunctions.length > 3 ? ` and ${params.relatedFunctions.length - 3} more` : '';
      focusItems.push(`**${params.relatedFunctions.length} functions**: ${funcList}${moreFuncs}`);
    }
    if (params.relatedClasses && params.relatedClasses.length > 0) {
      const classList = params.relatedClasses
        .slice(0, 3)
        .map((c) => `\`${c.name}\`` + (c.filePath ? ` (${c.filePath})` : ''))
        .join(', ');
      const moreClasses =
        params.relatedClasses.length > 3 ? ` and ${params.relatedClasses.length - 3} more` : '';
      focusItems.push(`**${params.relatedClasses.length} classes**: ${classList}${moreClasses}`);
    }
    if (params.focusNodes && params.focusNodes.length > 0) {
      focusItems.push(`**${params.focusNodes.length} specific nodes**`);
    }

    const focusSection =
      focusItems.length > 0 ? `\n\n**Focusing on:**\n${focusItems.join('\n')}` : '';

    const confirmationMessages = {
      title: 'Generate LLM Code Map',
      message: new vscode.MarkdownString(
        `Analyze code dependencies and structure` +
          (workspacePath ? ` in \`${workspacePath}\`` : ' in the current workspace') +
          (params.filePattern ? ` matching \`${params.filePattern}\`` : '') +
          focusSection +
          '?'
      ),
    };

    return {
      invocationMessage: 'Analyzing code structure and dependencies',
      confirmationMessages,
    };
  }

  async invoke(
    options: vscode.LanguageModelToolInvocationOptions<ICodemapParameters>,
    token: vscode.CancellationToken
  ): Promise<vscode.LanguageModelToolResult> {
    try {
      const params = options.input;
      const workspacePath =
        params.workspacePath || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

      if (!workspacePath) {
        throw new Error('Workspace path is not available. Please open a workspace first.');
      }

      // コード解析
      vscode.window.setStatusBarMessage('Analyzing code...', 1000);
      const analysisResult = await this._analyzer.analyzeWorkspace(
        workspacePath,
        params.filePattern
      );

      if (token.isCancellationRequested) {
        return new vscode.LanguageModelToolResult([
          new vscode.LanguageModelTextPart('Code map analysis was cancelled.'),
        ]);
      }

      // 依存関係抽出
      vscode.window.setStatusBarMessage('Extracting dependencies...', 1000);

      // LLMが直接ノードとエッジを指定している場合、それを使用
      if (params.nodes && params.edges) {
        console.log(
          `[LLM-CodeMap] Using LLM-specified nodes (${params.nodes.length}) and edges (${params.edges.length})`
        );
        const graphData = this._extractor.createGraphFromLLMSpec(params.nodes, params.edges);
        this._viewProvider.updateGraph(graphData);

        const summary =
          `Code map generated successfully from LLM specification. ` +
          `Displaying ${params.nodes.length} nodes and ${params.edges.length} edges. ` +
          `The graph is displayed in the LLM Code Map sidebar view.`;

        return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(summary)]);
      }

      // 従来の方法で依存関係を抽出
      const graphData = await this._extractor.extractGraphData(
        this._analyzer,
        analysisResult,
        params.targetFile,
        params.relatedFiles,
        params.relatedFunctions,
        params.relatedClasses,
        params.focusNodes
      );

      if (token.isCancellationRequested) {
        return new vscode.LanguageModelToolResult([
          new vscode.LanguageModelTextPart('Code map analysis was cancelled.'),
        ]);
      }

      // グラフを更新
      this._viewProvider.updateGraph(graphData);

      // 結果メッセージ
      const nodeCount = graphData.nodes.length;
      const edgeCount = graphData.edges.length;
      const fileCount = analysisResult.files.length;
      const functionCount = analysisResult.functions.length;
      const classCount = analysisResult.classes.length;

      const summary =
        `Code map generated successfully. ` +
        `Found ${nodeCount} nodes (${fileCount} files, ${functionCount} functions, ${classCount} classes) ` +
        `and ${edgeCount} dependencies. ` +
        `The graph is displayed in the LLM Code Map sidebar view.`;

      return new vscode.LanguageModelToolResult([new vscode.LanguageModelTextPart(summary)]);
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);

      // LLMに適切なエラーメッセージを返す
      return new vscode.LanguageModelToolResult([
        new vscode.LanguageModelTextPart(
          `Failed to generate code map: ${errorMessage}. ` +
            `Please ensure that a workspace is open and contains TypeScript or JavaScript files.`
        ),
      ]);
    }
  }
}
