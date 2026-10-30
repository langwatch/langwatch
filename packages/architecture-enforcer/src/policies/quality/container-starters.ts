import ts from "typescript";

import { resolveRelativeModule, sourceFile } from "../../workspace/module-graph.ts";

/** The starter the testing rules name; it may come from any module, a package subpath included. */
const NAMED_STARTERS = new Set(["startTestClickHouseEndpoints"]);
const TESTCONTAINERS = /^(?:testcontainers|@testcontainers\/[^/]+)$/;

/** What a local name was imported as: a testcontainers class, or a name in another module. */
type Binding = {
  name: string;
  /** The file a relative specifier names; absent for a package specifier. */
  file: string | undefined;
  testcontainers: boolean;
};

const startingNames = new Map<string, ReadonlySet<string>>();
const reading = new Set<string>();

/** The bindings one import clause introduces, by local name. */
function clauseBindings({
  clause,
  target,
}: {
  clause: ts.ImportClause;
  target: Pick<Binding, "file" | "testcontainers">;
}) {
  const bindings = new Map<string, Binding>();
  if (clause.name) bindings.set(clause.name.text, { name: "default", ...target });
  const named = clause.namedBindings;
  if (named && ts.isNamespaceImport(named)) bindings.set(named.name.text, { name: "*", ...target });
  if (named && ts.isNamedImports(named)) {
    for (const element of named.elements) {
      if (element.isTypeOnly) continue;
      const name = (element.propertyName ?? element.name).text;
      bindings.set(element.name.text, { name, ...target });
    }
  }
  return bindings;
}

function bindingsOf({ source, file }: { source: ts.SourceFile; file: string }) {
  const bindings = new Map<string, Binding>();
  for (const statement of source.statements) {
    if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier))
      continue;
    const clause = statement.importClause;
    if (!clause || clause.isTypeOnly) continue;
    const specifier = statement.moduleSpecifier.text;
    const target = {
      file: resolveRelativeModule({ file, specifier }),
      testcontainers: TESTCONTAINERS.test(specifier),
    };
    for (const [name, binding] of clauseBindings({ clause, target })) bindings.set(name, binding);
  }
  return bindings;
}

/** Top-level functions, classes and initialised variables, by name. */
function declarationsOf(source: ts.SourceFile): Map<string, ts.Node> {
  const declarations = new Map<string, ts.Node>();
  for (const statement of source.statements) {
    if (
      (ts.isFunctionDeclaration(statement) || ts.isClassDeclaration(statement)) &&
      statement.name
    ) {
      declarations.set(statement.name.text, statement);
    }
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.initializer) {
        declarations.set(declaration.name.text, declaration.initializer);
      }
    }
  }
  return declarations;
}

/** Whether a call or `new` under `node` reaches a starter, as `isStarter` judges each callee. */
function callsStarter({
  node,
  isStarter,
}: {
  node: ts.Node;
  isStarter: (call: { callee: ts.Expression; constructs: boolean }) => boolean;
}): boolean {
  const visit = (child: ts.Node): boolean => {
    const constructs = ts.isNewExpression(child);
    if (constructs || ts.isCallExpression(child)) {
      if (isStarter({ callee: child.expression, constructs })) return true;
    }
    return ts.forEachChild(child, visit) ?? false;
  };
  return visit(node);
}

/** Whether `namespace.name(...)` calls a starter of the module the namespace import names. */
function namespaceCallStarts({
  callee,
  bindings,
}: {
  callee: ts.PropertyAccessExpression;
  bindings: ReadonlyMap<string, Binding>;
}) {
  if (!ts.isIdentifier(callee.expression)) return false;
  const namespace = bindings.get(callee.expression.text);
  return namespace?.name === "*" && namespace.file !== undefined
    ? containerStartingNames(namespace.file).has(callee.name.text)
    : false;
}

/** Whether calling an imported name starts a container. */
function importedCallStarts({ binding, constructs }: { binding: Binding; constructs: boolean }) {
  if (binding.testcontainers) return constructs;
  if (NAMED_STARTERS.has(binding.name)) return true;
  return binding.file !== undefined && containerStartingNames(binding.file).has(binding.name);
}

/** A callee judge for one file: its own starting names, plus what its imports bring in. */
function starterJudge({
  bindings,
  local,
}: {
  bindings: ReadonlyMap<string, Binding>;
  local: ReadonlySet<string>;
}) {
  return ({ callee, constructs }: { callee: ts.Expression; constructs: boolean }): boolean => {
    if (ts.isPropertyAccessExpression(callee)) return namespaceCallStarts({ callee, bindings });
    if (!ts.isIdentifier(callee)) return false;
    if (local.has(callee.text)) return true;
    const binding = bindings.get(callee.text);
    return binding !== undefined && importedCallStarts({ binding, constructs });
  };
}

/** Grows `starting` with every declaration whose body calls a starter, until nothing changes. */
function growStarting({
  declarations,
  starting,
  isStarter,
}: {
  declarations: ReadonlyMap<string, ts.Node>;
  starting: Set<string>;
  isStarter: Parameters<typeof callsStarter>[0]["isStarter"];
}) {
  for (let grew = true; grew;) {
    grew = false;
    for (const [name, node] of declarations) {
      if (starting.has(name) || !callsStarter({ node, isStarter })) continue;
      starting.add(name);
      grew = true;
    }
  }
}

/** Adds the starters one `export ... from` statement passes on. */
function addReexported({
  statement,
  file,
  starting,
}: {
  statement: ts.ExportDeclaration;
  file: string;
  starting: Set<string>;
}) {
  const specifier = statement.moduleSpecifier;
  if (!specifier || !ts.isStringLiteral(specifier)) return;
  const target = resolveRelativeModule({ file, specifier: specifier.text });
  if (!target) return;
  const reexported = containerStartingNames(target);
  const clause = statement.exportClause;
  if (!clause) for (const name of reexported) starting.add(name);
  if (!clause || !ts.isNamedExports(clause)) return;
  for (const element of clause.elements) {
    if (reexported.has((element.propertyName ?? element.name).text))
      starting.add(element.name.text);
  }
}

/**
 * The names a module declares or re-exports whose call starts a container. Read by
 * call, not by import: a file that takes only a constant from a harness starts nothing.
 */
function containerStartingNames(file: string): ReadonlySet<string> {
  const cached = startingNames.get(file);
  if (cached) return cached;
  if (reading.has(file)) return new Set();
  reading.add(file);
  const source = sourceFile({ file, parents: false });
  const bindings = bindingsOf({ source, file });
  const starting = new Set<string>();
  const isStarter = starterJudge({ bindings, local: starting });
  growStarting({ declarations: declarationsOf(source), starting, isStarter });
  for (const statement of source.statements) {
    if (ts.isExportDeclaration(statement) && !statement.isTypeOnly)
      addReexported({ statement, file, starting });
  }
  reading.delete(file);
  startingNames.set(file, starting);
  return starting;
}

/** Whether running this test file starts a container, directly or through a local helper. */
export function startsContainers(file: string): boolean {
  const source = sourceFile({ file, parents: false });
  const isStarter = starterJudge({
    bindings: bindingsOf({ source, file }),
    local: containerStartingNames(file),
  });
  return callsStarter({ node: source, isStarter });
}
