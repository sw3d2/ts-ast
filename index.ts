import * as ts from "typescript";

function compile(fileNames: string[], options: ts.CompilerOptions): void {
  let program = ts.createProgram(fileNames, options);

  for (let file of program.getSourceFiles()) {
    if (/node_modules/.test(file.fileName))
      continue;
    console.log('src file:', file.fileName);
    ts.forEachChild(file, node => {
      console.log('ast node:', getNodeSummary(node, file));
    });
  }
}

function getNodeSummary(node: ts.Node, file: ts.SourceFile) {
  if (ts.isFunctionDeclaration(node))
    return node.name!.text;
  if (ts.isVariableStatement(node))
    return node.declarationList.declarations[0].name.getText(file);
  if (ts.isInterfaceDeclaration(node))
    return node.name.text;
  return node.kind;
}

compile(process.argv.slice(2), {
  noEmitOnError: true,
  noImplicitAny: true,
  target: ts.ScriptTarget.ES5,
  module: ts.ModuleKind.CommonJS
});