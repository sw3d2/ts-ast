import * as ts from 'typescript';
import * as fspath from 'path';
import * as glob from 'glob';
import * as commander from 'commander';

interface SourceFile2 extends ts.SourceFile {
  resolvedModules: Map<string, { resolvedFileName: string }>;
}

const TSCONFIG_FILENAME = 'tsconfig.json';
const EXCLUDED_FILEPATHS = /\/node_modules\//;
const GLOB_PATTERN = '**/*.{js,ts}';
const BATCH_FILES = 256;

const EXCLUDED_TSNODES = new Set([
  ts.SyntaxKind.EndOfFileToken,
  ts.SyntaxKind.ImportDeclaration,
  ts.SyntaxKind.TypeAliasDeclaration,
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
  ts.SyntaxKind.ExportAssignment,
]);

const COMPOSITE_TSNODES = new Set([
  ts.SyntaxKind.ModuleDeclaration,
  ts.SyntaxKind.ModuleBlock,
  ts.SyntaxKind.ClassDeclaration,
  ts.SyntaxKind.InterfaceDeclaration,
]);

const EXTRA_COMPOSITE_NODES = new Set([
  ts.SyntaxKind.WhileStatement,
  ts.SyntaxKind.ForInStatement,
  ts.SyntaxKind.ForOfStatement,
  ts.SyntaxKind.ForStatement,
  ts.SyntaxKind.ExpressionStatement,
  ts.SyntaxKind.CallExpression,
  ts.SyntaxKind.FunctionExpression,
  ts.SyntaxKind.ArrowFunction,
  ts.SyntaxKind.FunctionDeclaration,
  ts.SyntaxKind.Block,
]);

const DEFAULT_COMPILER_OPTIONS: ts.CompilerOptions = {
  "lib": ["es2017"],
  "allowJs": true,
  "noImplicitAny": false,
};

export interface FileFormat {
  format: 'vast';
  version: string;
  source: string;
  colors: HexColors;
  timestamp: string;
  vast: TreeNode;
}

export type NodeType =
  | 'program'
  | 'dir'
  | 'file'
  | 'module'
  | 'module-block'
  | 'class'
  | 'interface'
  | 'constructor'
  | 'method'
  | 'function'
  | 'text';

export interface HexColors {
  [nodeType: string]: string;
}

const DEFAULT_COLORS: HexColors = {
  'program': '#f0f',
  'dir': '#0ff',
  'file': '#00f',
  'module': '#00c',
  'interface': '#0c0',
  'class': '#0f0',
  'constructor': '#800',
  'method': '#c00',
  'function': '#f00',
};

export interface TreeNode {
  name: string;
  type: NodeType;
  size?: number;
  deps?: string[];
  children?: TreeNode[];
}

interface TsConfigSubset {
  options: ts.CompilerOptions;
  fileNames: string[];
  projectReferences?: readonly ts.ProjectReference[];
}

const log = new class Logger {
  i(...args) {
    console.log(...args);
  }

  d(...args) {
    cargs.debug && console.debug(...args);
  }
};

const cargs = parseCommandLineArgs();

function parseTsProject(projectDir: string, alreadyParsed = new Set<string>()): TreeNode | null {
  if (!projectDir.endsWith('/'))
    projectDir += '/';

  if (alreadyParsed.has(projectDir))
    return null;

  alreadyParsed.add(projectDir);
  log.d('tsproject:', projectDir);

  let tsConfig = parseTsConfig(projectDir);
  let projectName = projectDir.split('/').slice(-2)[0];
  let tree: TreeNode = { name: projectName, type: 'program', children: [] };

  for (let baseFile = 0; baseFile < tsConfig.fileNames.length; baseFile += BATCH_FILES) {
    log.d('processing batch:', baseFile / BATCH_FILES);
    let fileNamesBatch = tsConfig.fileNames.slice(baseFile, baseFile + BATCH_FILES);
    let program = ts.createProgram(fileNamesBatch, tsConfig.options);

    for (let file of program.getSourceFiles()) {
      if (EXCLUDED_FILEPATHS.test(file.fileName))
        continue;

      let [type, filepath, size] = getNodeSummary(file, file);
      let relpath = filepath.replace(projectDir, '');
      let name = relpath.split('/').slice(-1)[0];
      let children = inspectSubNodes(file, file);
      let deps = getNodeDeps(file);
      let node: TreeNode = { name, type, size, children };
      if (deps) node.deps = deps;
      insertFileNode(tree, node, relpath);
    }

    for (let pref of tsConfig.projectReferences || []) {
      let subtree = parseTsProject(pref.path, alreadyParsed);
      if (subtree) tree.children!.push(subtree);
    }
  }

  return tree;
}

function insertFileNode(tree: TreeNode, node: TreeNode, relpath: string) {
  let i = relpath.indexOf('/');
  let dirname = i < 0 ? null : relpath.slice(0, i);

  if (!dirname) {
    tree.children!.push(node);
    return;
  }

  let dirnode = tree.children!.find(
    x => x.type == 'dir' && x.name == dirname);

  if (!dirnode) {
    dirnode = { type: 'dir', name: dirname, children: [] };
    tree.children!.push(dirnode);
  }

  insertFileNode(dirnode, node, relpath.slice(i + 1));
}

function isComposite(node: ts.Node) {
  if (COMPOSITE_TSNODES.has(node.kind))
    return true;

  if (cargs.expandFunctions && EXTRA_COMPOSITE_NODES.has(node.kind))
    return true;

  return false;
}

function inspectSubNodes(root: ts.Node, file: ts.SourceFile): TreeNode[] {
  let treenodes: TreeNode[] = [];

  ts.forEachChild(root, node => {
    if (EXCLUDED_TSNODES.has(node.kind))
      return;

    let [type, name, size] = getNodeSummary(node, file);
    let deep = isComposite(node);
    let children = deep ? inspectSubNodes(node, file) : [];

    if (name || deep || cargs.addUnnamedLeafs)
      treenodes.push({ name, type, size, children });
  });

  return treenodes;
}

function parseTsConfig(projectDir: string): TsConfigSubset {
  let tsConfigPath = projectDir + TSCONFIG_FILENAME;

  if (!ts.sys.fileExists(tsConfigPath)) {
    log.d(`${TSCONFIG_FILENAME} doesnt exist`);
    return generateTsConfig(projectDir);
  }

  log.d(`Parsing ${tsConfigPath}`);

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

  log.d(`${parsed.fileNames.length} ts files found`);
  return parsed;
}

function generateTsConfig(projectDir: string): TsConfigSubset {
  log.d(`Searching for ${GLOB_PATTERN}`);
  let files = glob.sync(projectDir + GLOB_PATTERN);
  log.d(`${files.length} files found`);

  return {
    fileNames: files,
    projectReferences: [],
    options: DEFAULT_COMPILER_OPTIONS,
  };
}

function getNodeSummary(node: ts.Node, file: ts.SourceFile): [NodeType, string, number] {
  let [type, name] = getNodeTypeName(node, file);
  let size = getNodeSize(node, file);
  return [type!, name!, size];
}

function getNodeTypeName(node: ts.Node, file: ts.SourceFile): [NodeType, string] {
  if (ts.isSourceFile(node))
    return ['file', node.fileName];
  if (ts.isConstructorDeclaration(node))
    return ['constructor', ''];
  if (ts.isMethodDeclaration(node))
    return ['method', node.name.getText(file)];
  if (ts.isFunctionDeclaration(node))
    return ['function', node.name?.text!];
  if (ts.isInterfaceDeclaration(node))
    return ['interface', node.name.text!];
  if (ts.isClassDeclaration(node))
    return ['class', node.name?.text!];
  if (ts.isModuleDeclaration(node))
    return ['module', node.name.text];
  if (ts.isModuleBlock(node))
    return ['module-block', ''];
  if (ts.isMethodSignature(node))
    return ['method', node.name.getText(file)];
  if (ts.isStringLiteral(node))
    return ['text', node.text];
  return [(ts.SyntaxKind[node.kind] + ':' + node.kind) as any, ''];
}

function getNodeSize(node: ts.Node, file: ts.SourceFile) {
  return node.getFullText(file).length;
}

function getNodeDeps(node: ts.Node): string[] | null {
  if (ts.isSourceFile(node))
    return getImports(node);
  return null;
}

function getImports(file: ts.SourceFile) {
  let deps: string[] = [];

  ts.forEachChild(file, node => {
    if (!ts.isImportDeclaration(node))
      return;
    let name = node.moduleSpecifier;
    if (!ts.isStringLiteral(name))
      return;
    let importPath = name.text;
    let fullPath = (file as SourceFile2).resolvedModules
      .get(importPath)?.resolvedFileName;
    if (!fullPath)
      return;
    let basePath = cargs.project;
    let relPath = fspath.relative(basePath, fullPath);
    deps.push(relPath);
  });

  return deps;
}

interface CommandLineArgs {
  debug: boolean;
  project: string;
  expandFunctions: boolean;
  addUnnamedLeafs: boolean;
}

function parseCommandLineArgs(): CommandLineArgs {
  return commander
    .option('-d, --debug', 'Debug logging')
    .option('--add-unnamed-leafs')
    .option('--expand-functions')
    .option('-p, --project <s>', 'Project dir')
    .parse(process.argv) as any as CommandLineArgs;
}

function main() {
  if (!cargs.project)
    commander.help();

  let pdir = cargs.project;
  let tree = parseTsProject(pdir)!;
  let json: FileFormat = {
    format: 'vast',
    version: '1.0.0',
    source: pdir,
    colors: DEFAULT_COLORS,
    timestamp: new Date().toJSON(),
    vast: tree,
  };

  console.log(JSON.stringify(json, null, 2));
}

main();
