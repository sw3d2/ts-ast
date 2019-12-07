import * as ts from "typescript";

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

interface FileFormat {
  format: 'vast';
  version: string;
  source: string;
  timestamp: string;
  vast: TreeNode;
}

interface TreeNode {
  name: string;
  type: string;
  size?: number;
  children?: TreeNode[];
}

function parseTsProject(projectDir: string): FileFormat {
  if (!projectDir.endsWith('/'))
    projectDir += '/';

  let parsed = parseTsConfig(projectDir);
  let program = ts.createProgram(parsed.fileNames, parsed.options);
  let tree: TreeNode = { name: '', type: 'program', children: [] };

  for (let file of program.getSourceFiles()) {
    if (EXCLUDED_FILEPATHS.test(file.fileName))
      continue;

    let [type, filepath, size] = getNodeSummary(file, file);
    let name = filepath.replace(projectDir, '');
    let children = inspectSubNodes(file, file);
    tree.children!.push({ name, type, size, children });
  }

  return {
    format: 'vast',
    version: '1.0.0',
    source: projectDir,
    timestamp: new Date().toJSON(),
    vast: tree,
  };
}

function inspectSubNodes(root: ts.Node, file: ts.SourceFile): TreeNode[] {
  let treenodes: TreeNode[] = [];

  ts.forEachChild(root, node => {
    if (EXCLUDED_TSNODES.has(node.kind))
      return;

    let [type, name, size] = getNodeSummary(node, file);
    let children = COMPOSITE_TSNODES.has(node.kind) ?
      inspectSubNodes(node, file) : [];
    treenodes.push({ name, type, size, children });
  });

  return treenodes;
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

function getNodeSummary(node: ts.Node, file: ts.SourceFile): [string, string, number] {
  let [type, name] = getNodeTypeName(node, file);
  let size = getNodeSize(node, file);
  return [type!, name!, size];
}

function getNodeTypeName(node: ts.Node, file: ts.SourceFile) {
  if (ts.isSourceFile(node))
    return ['file', node.fileName];
  if (ts.isConstructorDeclaration(node))
    return ['constructor', ''];
  if (ts.isMethodDeclaration(node))
    return ['method', node.name.getText(file)];
  if (ts.isFunctionDeclaration(node))
    return ['function', node.name?.text];
  if (ts.isInterfaceDeclaration(node))
    return ['interface', node.name.text];
  if (ts.isClassDeclaration(node))
    return ['class', node.name?.text];
  if (ts.isModuleDeclaration(node))
    return ['module', node.name.text];
  if (ts.isMethodSignature(node))
    return ['method', node.name.getText(file)];
  return [ts.SyntaxKind[node.kind] + ':' + node.kind, ''];
}

function getNodeSize(node: ts.Node, file: ts.SourceFile) {
  return node.getFullText(file).length;
}

let tree = parseTsProject(process.argv[2]);
console.log(JSON.stringify(tree, null, 2));
