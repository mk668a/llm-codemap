import * as ts from 'typescript';
import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import {
  FileInfo,
  FunctionInfo,
  ClassInfo,
  MethodInfo,
  PropertyInfo,
  ImportInfo,
  ExportInfo,
} from './types';
import {
  findFiles,
  readFileContent,
  isTypeScriptOrJavaScriptFile,
  shouldExcludeFile,
} from '../utils/fileUtils';
import { normalizePath } from '../utils/pathUtils';

/**
 * TypeScript Compiler APIを使用したコード解析エンジン
 */
export class TypeScriptAnalyzer {
  private program?: ts.Program;
  private sourceFiles: Map<string, ts.SourceFile> = new Map();
  private workspacePath?: string;

  /**
   * ワークスペースを解析
   */
  async analyzeWorkspace(
    workspacePath?: string,
    filePattern?: string
  ): Promise<{
    files: FileInfo[];
    functions: FunctionInfo[];
    classes: ClassInfo[];
    imports: ImportInfo[];
    exports: ExportInfo[];
  }> {
    this.workspacePath = workspacePath || vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;

    if (!this.workspacePath) {
      throw new Error('Workspace path is not available');
    }

    // ファイルを検索
    const pattern = filePattern || '**/*.{ts,tsx,js,jsx}';
    console.log(`[LLM-CodeMap] Searching for files with pattern: ${pattern}`);
    const uris = await findFiles(pattern);
    console.log(`[LLM-CodeMap] Found ${uris.length} files matching pattern`);

    // TypeScript/JavaScriptファイルのみをフィルタ
    const fileInfos: FileInfo[] = [];
    let processedCount = 0;
    let excludedCount = 0;
    let nonTsJsCount = 0;
    const totalFiles = uris.length;

    console.log(`[LLM-CodeMap] Filtering ${totalFiles} files...`);

    for (const uri of uris) {
      // 除外パターンチェック
      if (shouldExcludeFile(uri.fsPath)) {
        excludedCount++;
        continue;
      }

      if (isTypeScriptOrJavaScriptFile(uri.fsPath)) {
        try {
          const content = await readFileContent(uri);
          fileInfos.push({
            path: uri.fsPath,
            content,
          });
          processedCount++;

          // 進捗ログ（100ファイルごと）
          if (processedCount % 100 === 0) {
            console.log(
              `[LLM-CodeMap] Processed ${processedCount} files (excluded: ${excludedCount}, non-TS/JS: ${nonTsJsCount})...`
            );
          }
        } catch (error) {
          console.warn(`[LLM-CodeMap] Failed to read file ${uri.fsPath}: ${error}`);
        }
      } else {
        nonTsJsCount++;
      }
    }

    console.log(
      `[LLM-CodeMap] Filtered to ${fileInfos.length} TypeScript/JavaScript files (excluded: ${excludedCount}, non-TS/JS: ${nonTsJsCount})`
    );

    // TypeScript Programを作成
    const filePaths = fileInfos.map((f) => f.path);
    console.log(`[LLM-CodeMap] Creating TypeScript program with ${filePaths.length} files...`);

    const compilerOptions: ts.CompilerOptions = {
      target: ts.ScriptTarget.Latest,
      module: ts.ModuleKind.ESNext,
      allowJs: true,
      checkJs: false,
      skipLibCheck: true,
    };

    try {
      this.program = ts.createProgram(filePaths, compilerOptions);
      console.log(`[LLM-CodeMap] TypeScript program created successfully`);
    } catch (error) {
      console.error(`[LLM-CodeMap] Failed to create TypeScript program: ${error}`);
      throw error;
    }

    // 各ファイルを解析
    const functions: FunctionInfo[] = [];
    const classes: ClassInfo[] = [];
    const imports: ImportInfo[] = [];
    const exports: ExportInfo[] = [];

    console.log(`[LLM-CodeMap] Analyzing ${fileInfos.length} source files...`);
    let analyzedCount = 0;

    for (const fileInfo of fileInfos) {
      const sourceFile = this.program!.getSourceFile(fileInfo.path);
      if (!sourceFile) {
        continue;
      }

      fileInfo.sourceFile = sourceFile;
      this.sourceFiles.set(fileInfo.path, sourceFile);

      // ファイル内の要素を解析
      try {
        this.analyzeSourceFile(sourceFile, fileInfo.path, functions, classes, imports, exports);
        analyzedCount++;

        // 進捗ログ（50ファイルごと）
        if (analyzedCount % 50 === 0) {
          console.log(`[LLM-CodeMap] Analyzed ${analyzedCount}/${fileInfos.length} files...`);
        }
      } catch (error) {
        console.warn(`[LLM-CodeMap] Failed to analyze file ${fileInfo.path}: ${error}`);
      }
    }

    console.log(
      `[LLM-CodeMap] Analysis complete: ${functions.length} functions, ${classes.length} classes, ${imports.length} imports, ${exports.length} exports`
    );

    return {
      files: fileInfos,
      functions,
      classes,
      imports,
      exports,
    };
  }

  /**
   * ソースファイルを解析
   */
  private analyzeSourceFile(
    sourceFile: ts.SourceFile,
    filePath: string,
    functions: FunctionInfo[],
    classes: ClassInfo[],
    imports: ImportInfo[],
    exports: ExportInfo[]
  ): void {
    const visit = (node: ts.Node) => {
      try {
        // 関数宣言
        if (ts.isFunctionDeclaration(node) && node.name) {
          const funcInfo = this.extractFunctionInfo(node, sourceFile, filePath);
          if (funcInfo) {
            functions.push(funcInfo);
          }
        }

        // 関数式（変数代入）
        if (ts.isVariableStatement(node)) {
          for (const declaration of node.declarationList.declarations) {
            if (declaration.initializer && ts.isFunctionExpression(declaration.initializer)) {
              const funcInfo = this.extractFunctionExpressionInfo(
                declaration,
                sourceFile,
                filePath
              );
              if (funcInfo) {
                functions.push(funcInfo);
              }
            }
          }
        }

        // アロー関数（変数代入）
        if (ts.isVariableStatement(node)) {
          for (const declaration of node.declarationList.declarations) {
            if (declaration.initializer && ts.isArrowFunction(declaration.initializer)) {
              const funcInfo = this.extractArrowFunctionInfo(declaration, sourceFile, filePath);
              if (funcInfo) {
                functions.push(funcInfo);
              }
            }
          }
        }

        // クラス宣言
        if (ts.isClassDeclaration(node) && node.name) {
          const classInfo = this.extractClassInfo(node, sourceFile, filePath);
          if (classInfo) {
            classes.push(classInfo);
          }
        }

        // インポート
        if (ts.isImportDeclaration(node)) {
          const importInfo = this.extractImportInfo(node, sourceFile, filePath);
          if (importInfo) {
            imports.push(importInfo);
          }
        }

        // エクスポート
        if (ts.isExportDeclaration(node) || ts.isExportAssignment(node)) {
          const exportInfos = this.extractExportInfo(node, sourceFile, filePath);
          exports.push(...exportInfos);
        }

        // 名前付きエクスポート（export function, export classなど）
        const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
        if (modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword)) {
          if (ts.isFunctionDeclaration(node)) {
            const funcNode = node; // 型を明確に分離
            const nodeName = funcNode.name;
            if (nodeName && ts.isIdentifier(nodeName) && nodeName.text) {
              const funcName = nodeName.text; // 安全に保存
              const funcInfo = this.extractFunctionInfo(funcNode, sourceFile, filePath);
              if (funcInfo) {
                funcInfo.isExported = true;
                const exportInfo: ExportInfo = {
                  name: funcName,
                  type: 'named',
                  filePath,
                  line: this.getNodePosition(funcNode, sourceFile, filePath).line + 1,
                  column: this.getNodePosition(funcNode, sourceFile, filePath).character + 1,
                };
                exports.push(exportInfo);
              }
            }
          } else if (ts.isClassDeclaration(node)) {
            const classNode = node; // 型を明確に分離
            const nodeName = classNode.name;
            if (nodeName && ts.isIdentifier(nodeName) && nodeName.text) {
              const className = nodeName.text; // 安全に保存
              const classInfo = this.extractClassInfo(classNode, sourceFile, filePath);
              if (classInfo) {
                classInfo.isExported = true;
                const exportInfo: ExportInfo = {
                  name: className,
                  type: 'named',
                  filePath,
                  line: this.getNodePosition(classNode, sourceFile, filePath).line + 1,
                  column: this.getNodePosition(classNode, sourceFile, filePath).character + 1,
                };
                exports.push(exportInfo);
              }
            }
          }
        }
      } catch (error) {
        // 個別のノード解析でエラーが発生しても続行
        const errorMessage = error instanceof Error ? error.message : String(error);
        const stackTrace = error instanceof Error ? error.stack : '';
        console.warn(`[LLM-CodeMap] Error analyzing node in ${filePath}: ${errorMessage}`);
        if (stackTrace) {
          console.warn(
            `[LLM-CodeMap] Stack trace: ${stackTrace.split('\n').slice(0, 5).join('\n')}`
          );
        }
      }

      ts.forEachChild(node, visit);
    };

    try {
      visit(sourceFile);
    } catch (error) {
      console.warn(`[LLM-CodeMap] Error in visit function for ${filePath}: ${error}`);
    }
  }

  /**
   * ノードの位置情報を安全に取得
   */
  private getNodePosition(
    node: ts.Node,
    sourceFile: ts.SourceFile,
    filePath: string
  ): { line: number; character: number } {
    try {
      // node.posが有効な場合はそれを使用、そうでない場合はgetStart()を試す
      let startPos: number;
      if (node.pos !== undefined && node.pos >= 0) {
        startPos = node.pos;
      } else {
        try {
          startPos = node.getStart();
        } catch (getStartError) {
          // getStart()がエラーを投げた場合、node.posを使用（-1の可能性がある）
          startPos = node.pos !== undefined ? node.pos : 0;
        }
      }

      // startPosが有効な範囲内か確認
      if (startPos < 0 || startPos >= sourceFile.text.length) {
        return { line: 0, character: 0 };
      }

      return sourceFile.getLineAndCharacterOfPosition(startPos);
    } catch (error) {
      console.warn(`[LLM-CodeMap] Failed to get position for node in ${filePath}: ${error}`);
      return { line: 0, character: 0 };
    }
  }

  /**
   * 関数情報を抽出
   */
  private extractFunctionInfo(
    node: ts.FunctionDeclaration,
    sourceFile: ts.SourceFile,
    filePath: string
  ): FunctionInfo | null {
    if (!node.name || !ts.isIdentifier(node.name)) {
      return null;
    }

    const pos = this.getNodePosition(node, sourceFile, filePath);
    const parameters = node.parameters
      .map((p) => {
        const paramName = p.name;
        if (paramName && ts.isIdentifier(paramName) && paramName.text) {
          return paramName.text;
        }
        // オブジェクトパターンや配列パターンの場合は空文字列を返す
        return '';
      })
      .filter((p) => p !== '');

    const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
    const nodeName = node.name;
    if (!nodeName || !ts.isIdentifier(nodeName) || !nodeName.text) {
      return null;
    }
    const name = nodeName.text; // 安全に保存
    return {
      name: name,
      filePath,
      line: pos.line + 1,
      column: pos.character + 1,
      isExported: modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) || false,
      isAsync: modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword) || false,
      parameters,
      returnType: node.type ? this.getTypeText(node.type, sourceFile) : undefined,
    };
  }

  /**
   * 関数式情報を抽出
   */
  private extractFunctionExpressionInfo(
    declaration: ts.VariableDeclaration,
    sourceFile: ts.SourceFile,
    filePath: string
  ): FunctionInfo | null {
    if (!ts.isIdentifier(declaration.name)) {
      return null;
    }

    const initializer = declaration.initializer;
    if (!initializer || !ts.isFunctionExpression(initializer)) {
      return null;
    }

    const pos = this.getNodePosition(declaration, sourceFile, filePath);
    const parameters = initializer.parameters
      .map((p) => {
        const paramName = p.name;
        if (paramName && ts.isIdentifier(paramName) && paramName.text) {
          return paramName.text;
        }
        // オブジェクトパターンや配列パターンの場合は空文字列を返す
        return '';
      })
      .filter((p) => p !== '');

    const initializerModifiers = ts.canHaveModifiers(initializer)
      ? ts.getModifiers(initializer)
      : undefined;
    const declName = declaration.name;
    if (!ts.isIdentifier(declName) || !declName.text) {
      return null;
    }
    const name = declName.text; // 安全に保存
    return {
      name: name,
      filePath,
      line: pos.line + 1,
      column: pos.character + 1,
      isExported: false,
      isAsync: initializerModifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword) || false,
      parameters,
      returnType: initializer.type ? this.getTypeText(initializer.type, sourceFile) : undefined,
    };
  }

  /**
   * アロー関数情報を抽出
   */
  private extractArrowFunctionInfo(
    declaration: ts.VariableDeclaration,
    sourceFile: ts.SourceFile,
    filePath: string
  ): FunctionInfo | null {
    if (!ts.isIdentifier(declaration.name)) {
      return null;
    }

    const initializer = declaration.initializer;
    if (!initializer || !ts.isArrowFunction(initializer)) {
      return null;
    }

    const pos = this.getNodePosition(declaration, sourceFile, filePath);
    const parameters = initializer.parameters
      .map((p) => {
        const paramName = p.name;
        if (paramName && ts.isIdentifier(paramName) && paramName.text) {
          return paramName.text;
        }
        // オブジェクトパターンや配列パターンの場合は空文字列を返す
        return '';
      })
      .filter((p) => p !== '');

    const declName = declaration.name;
    if (!ts.isIdentifier(declName) || !declName.text) {
      return null;
    }
    const name = declName.text; // 安全に保存
    return {
      name: name,
      filePath,
      line: pos.line + 1,
      column: pos.character + 1,
      isExported: false,
      isAsync: initializer.modifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword) || false,
      parameters,
      returnType: initializer.type ? this.getTypeText(initializer.type, sourceFile) : undefined,
    };
  }

  /**
   * クラス情報を抽出
   */
  private extractClassInfo(
    node: ts.ClassDeclaration,
    sourceFile: ts.SourceFile,
    filePath: string
  ): ClassInfo | null {
    const nodeName = node.name;
    if (!nodeName || !ts.isIdentifier(nodeName) || !nodeName.text) {
      return null;
    }

    const pos = this.getNodePosition(node, sourceFile, filePath);
    const methods: MethodInfo[] = [];
    const properties: PropertyInfo[] = [];

    // メソッドとプロパティを抽出
    for (const member of node.members) {
      const memberName = member.name;
      if (
        ts.isMethodDeclaration(member) &&
        memberName &&
        ts.isIdentifier(memberName) &&
        memberName.text
      ) {
        const methodName = memberName.text; // 安全に保存
        const methodPos = this.getNodePosition(member, sourceFile, filePath);
        const parameters = member.parameters
          .map((p) => {
            const paramName = p.name;
            if (paramName && ts.isIdentifier(paramName) && paramName.text) {
              return paramName.text;
            }
            // オブジェクトパターンや配列パターンの場合は空文字列を返す
            return '';
          })
          .filter((p) => p !== '');

        const memberModifiers = ts.canHaveModifiers(member) ? ts.getModifiers(member) : undefined;
        methods.push({
          name: methodName,
          filePath,
          line: methodPos.line + 1,
          column: methodPos.character + 1,
          isPublic: !memberModifiers?.some((m) => m.kind === ts.SyntaxKind.PrivateKeyword),
          isStatic: memberModifiers?.some((m) => m.kind === ts.SyntaxKind.StaticKeyword) || false,
          isAsync: memberModifiers?.some((m) => m.kind === ts.SyntaxKind.AsyncKeyword) || false,
          parameters,
          returnType: member.type ? this.getTypeText(member.type, sourceFile) : undefined,
        });
      }

      if (ts.isPropertyDeclaration(member)) {
        const propMemberName = member.name;
        if (ts.isIdentifier(propMemberName) && propMemberName.text) {
          const propName = propMemberName.text; // 安全に保存
          const propPos = this.getNodePosition(member, sourceFile, filePath);
          const memberModifiers = ts.canHaveModifiers(member) ? ts.getModifiers(member) : undefined;
          properties.push({
            name: propName,
            filePath,
            line: propPos.line + 1,
            column: propPos.character + 1,
            type: member.type ? this.getTypeText(member.type, sourceFile) : undefined,
            isPublic: !memberModifiers?.some((m) => m.kind === ts.SyntaxKind.PrivateKeyword),
            isStatic: memberModifiers?.some((m) => m.kind === ts.SyntaxKind.StaticKeyword) || false,
          });
        }
      }
    }

    const finalNodeName = node.name;
    if (!finalNodeName || !ts.isIdentifier(finalNodeName) || !finalNodeName.text) {
      return null;
    }
    const name = finalNodeName.text; // 安全に保存
    return {
      name: name,
      filePath,
      line: pos.line + 1,
      column: pos.character + 1,
      isExported: (() => {
        const modifiers = ts.canHaveModifiers(node) ? ts.getModifiers(node) : undefined;
        return modifiers?.some((m) => m.kind === ts.SyntaxKind.ExportKeyword) || false;
      })(),
      extends: (() => {
        const extendsClause = node.heritageClauses?.find(
          (h) => h.token === ts.SyntaxKind.ExtendsKeyword
        );
        if (extendsClause && extendsClause.types.length > 0) {
          const expression = extendsClause.types[0].expression;
          if (expression && ts.isIdentifier(expression)) {
            const exprText = expression.text;
            if (exprText) {
              return exprText; // ここはreturnなので問題ない
            }
          }
        }
        return undefined;
      })(),
      implements:
        node.heritageClauses
          ?.find((h) => h.token === ts.SyntaxKind.ImplementsKeyword)
          ?.types.map((t) => {
            const expr = t.expression;
            if (expr && ts.isIdentifier(expr) && expr.text) {
              return expr.text;
            }
            return '';
          })
          .filter((t) => t !== '') || [],
      methods,
      properties,
    };
  }

  /**
   * インポート情報を抽出
   */
  private extractImportInfo(
    node: ts.ImportDeclaration,
    sourceFile: ts.SourceFile,
    filePath: string
  ): ImportInfo | null {
    const moduleSpec = node.moduleSpecifier;
    if (!moduleSpec || !ts.isStringLiteral(moduleSpec) || !moduleSpec.text) {
      return null;
    }

    const from = moduleSpec.text;
    const imports: string[] = [];
    let isDefault = false;
    let isNamespace = false;

    if (node.importClause) {
      // デフォルトインポート
      const importClauseName = node.importClause.name;
      if (importClauseName && ts.isIdentifier(importClauseName) && importClauseName.text) {
        const importName = importClauseName.text; // 安全に保存
        imports.push(importName);
        isDefault = true;
      }

      // 名前付きインポート
      if (node.importClause.namedBindings) {
        if (ts.isNamespaceImport(node.importClause.namedBindings)) {
          const namespaceNameNode = node.importClause.namedBindings.name;
          if (namespaceNameNode && ts.isIdentifier(namespaceNameNode) && namespaceNameNode.text) {
            const namespaceName = namespaceNameNode.text; // 安全に保存
            imports.push(namespaceName);
            isNamespace = true;
          }
        } else if (ts.isNamedImports(node.importClause.namedBindings)) {
          for (const element of node.importClause.namedBindings.elements) {
            const elementNameNode = element.name;
            if (elementNameNode && ts.isIdentifier(elementNameNode) && elementNameNode.text) {
              const elementName = elementNameNode.text; // 安全に保存
              imports.push(elementName);
            }
          }
        }
      }
    }

    // 相対パスを絶対パスに変換
    let resolvedPath = from;
    if (from.startsWith('.') || from.startsWith('..')) {
      const baseDir = path.dirname(filePath);
      resolvedPath = normalizePath(from, baseDir);
      // .ts, .js拡張子を追加してファイルが存在するかチェック
      if (!fs.existsSync(resolvedPath)) {
        for (const ext of ['.ts', '.tsx', '.js', '.jsx', '/index.ts', '/index.js']) {
          const testPath = resolvedPath + ext;
          if (fs.existsSync(testPath)) {
            resolvedPath = testPath;
            break;
          }
        }
      }
    }

    return {
      from: resolvedPath,
      imports,
      isDefault,
      isNamespace,
    };
  }

  /**
   * エクスポート情報を抽出
   */
  private extractExportInfo(
    node: ts.Node,
    sourceFile: ts.SourceFile,
    filePath: string
  ): ExportInfo[] {
    const exports: ExportInfo[] = [];

    if (ts.isExportDeclaration(node) && node.exportClause) {
      if (ts.isNamedExports(node.exportClause)) {
        for (const element of node.exportClause.elements) {
          const elementNameNode = element.name;
          if (elementNameNode && ts.isIdentifier(elementNameNode) && elementNameNode.text) {
            const exportName = elementNameNode.text; // 安全に保存
            exports.push({
              name: exportName,
              type: 'named',
              filePath,
              line: this.getNodePosition(node, sourceFile, filePath).line + 1,
              column: this.getNodePosition(node, sourceFile, filePath).character + 1,
            });
          }
        }
      }
    }

    if (ts.isExportAssignment(node)) {
      exports.push({
        name: 'default',
        type: 'default',
        filePath,
        line: this.getNodePosition(node, sourceFile, filePath).line + 1,
        column: this.getNodePosition(node, sourceFile, filePath).character + 1,
      });
    }

    return exports;
  }

  /**
   * 型のテキスト表現を取得
   */
  private getTypeText(typeNode: ts.TypeNode, sourceFile: ts.SourceFile): string {
    const printer = ts.createPrinter();
    return printer.printNode(ts.EmitHint.Unspecified, typeNode, sourceFile);
  }

  /**
   * SourceFileを取得
   */
  getSourceFile(filePath: string): ts.SourceFile | undefined {
    return this.sourceFiles.get(filePath);
  }
}
