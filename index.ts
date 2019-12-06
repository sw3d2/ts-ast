import * as ts from "typescript";

const INDENT_STRING = '  ';
const TSCONFIG_FILENAME = 'tsconfig.json';
const EXCLUDED_FILEPATHS = /\/node_modules\//;

const EXCLUDED_TSNODES = new Set([
  ts.SyntaxKind.EndOfFileToken,
  ts.SyntaxKind.VariableStatement,
  ts.SyntaxKind.ImportDeclaration,
  ts.SyntaxKind.TypeAliasDeclaration,
  ts.SyntaxKind.ExpressionStatement,
  ts.SyntaxKind.Decorator,
  ts.SyntaxKind.Identifier,
  ts.SyntaxKind.IndexSignature,
  ts.SyntaxKind.ExportKeyword,
  ts.SyntaxKind.DefaultKeyword,
  ts.SyntaxKind.HeritageClause,
  ts.SyntaxKind.PropertyDeclaration,
  ts.SyntaxKind.DeclareKeyword,
  ts.SyntaxKind.PropertySignature,
  ts.SyntaxKind.TypeParameter,
  ts.SyntaxKind.IfStatement,
  ts.SyntaxKind.ExportAssignment,
  ts.SyntaxKind.CallSignature,
]);

const COMPOSITE_TSNODES = new Set([
  ts.SyntaxKind.ClassDeclaration,
  ts.SyntaxKind.ModuleDeclaration,
  ts.SyntaxKind.InterfaceDeclaration,
]);

function parseTsProject(projectDir: string): void {
  if (!projectDir.endsWith('/'))
    projectDir += '/';

  let parsed = parseTsConfig(projectDir);
  let program = ts.createProgram(parsed.fileNames, parsed.options);

  for (let file of program.getSourceFiles()) {
    if (EXCLUDED_FILEPATHS.test(file.fileName))
      continue;
    let summary = getNodeSummary(file, file)
      .replace(projectDir, '');
    console.log(summary);
    inspectSubNodes(file, file, 1);
  }
}

function inspectSubNodes(root: ts.Node, file: ts.SourceFile, depth: number) {
  ts.forEachChild(root, node => {
    if (EXCLUDED_TSNODES.has(node.kind))
      return;

    console.log(
      INDENT_STRING.repeat(depth) +
      getNodeSummary(node, file));

    if (COMPOSITE_TSNODES.has(node.kind))
      inspectSubNodes(node, file, depth + 1);
  });
}

function parseTsConfig(projectDir: string): ts.ParsedCommandLine {
  let tsConfigPath = ts.findConfigFile(
    projectDir,
    ts.sys.fileExists,
    TSCONFIG_FILENAME);

  let configFile = ts.readConfigFile(
    tsConfigPath!,
    ts.sys.readFile);

  let parseConfigHost: ts.ParseConfigHost = {
    fileExists: ts.sys.fileExists,
    readFile: ts.sys.readFile,
    readDirectory: ts.sys.readDirectory,
    useCaseSensitiveFileNames: true,
  };

  let parsed = ts.parseJsonConfigFileContent(
    configFile.config,
    parseConfigHost,
    projectDir);

  return parsed;
}

function getNodeName(node: ts.Node, file: ts.SourceFile) {
  if (ts.isSourceFile(node))
    return 'file ' + node.fileName;
  if (ts.isConstructorDeclaration(node))
    return 'constructor()';
  if (ts.isMethodDeclaration(node))
    return node.name.getText(file) + '()';
  if (ts.isFunctionDeclaration(node))
    return 'function ' + node.name?.text + '()';
  if (ts.isInterfaceDeclaration(node))
    return 'interface ' + node.name.text + '{}';
  if (ts.isClassDeclaration(node))
    return 'class ' + node.name?.text + '{}';
  if (ts.isModuleDeclaration(node))
    return 'module ' + node.name.text + '{}';
  if (ts.isMethodSignature(node))
    return node.name.getText(file) + '()';
  return ts.SyntaxKind[node.kind];
}

function getNodeSummary(node: ts.Node, file: ts.SourceFile) {
  return getNodeName(node, file) + ' ' + getNodeSize(node, file);
}

function getNodeSize(node: ts.Node, file: ts.SourceFile) {
  return node.getFullText(file).length;
}

parseTsProject(process.argv[2]);