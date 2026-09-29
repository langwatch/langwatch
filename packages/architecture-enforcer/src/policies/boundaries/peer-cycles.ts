import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";

import ts from "typescript";

import type { ArchitectureViolation, ClassifiedPackage } from "../../types.ts";
import { listFiles } from "../../workspace/layout.ts";
import { sourceFile, sourceText } from "../../workspace/module-graph.ts";
import type { WorkspaceSnapshot } from "../../workspace/snapshot.ts";

/**
 * Peer `*Api` cycles between modules, read from every process app's
 * `static dependencies`. See dev/docs/ARCHITECTURE.md §5: cycles refuse.
 */

const POLICY = "peer-cycles";
const TEST_FILE = /(?:__tests__|__fixtures__|\/fixtures\/|\.(?:test|spec)\.)/;
const SOURCE_FILE = /\.[cm]?tsx?$/;
const DECLARES_DEPENDENCIES = /\bstatic\s+(?:readonly\s+)?dependencies\b/;
const ALLOWED =
  "Cut the back edge from the reactor's side: the module being told reacts to the other's event and the teller drops its dependency. See dev/docs/ARCHITECTURE.md §5.";

/** One peer a module's `static dependencies` names, and where it names it. */
export type PeerEdge = { from: string; to: string; file: string; line: number };

/** A peer edge whose peer reaches back, with the shortest way back. */
export type PeerCycleEdge = PeerEdge & { back: readonly string[] };

type Located = { literal: ts.ObjectLiteralExpression; source: ts.SourceFile };

function unwrap(expression: ts.Expression): ts.Expression {
  if (ts.isAsExpression(expression) || ts.isSatisfiesExpression(expression))
    return unwrap(expression.expression);

  return ts.isParenthesizedExpression(expression) ? unwrap(expression.expression) : expression;
}

function isStatic(node: ts.PropertyDeclaration): boolean {
  return (ts.getModifiers(node) ?? []).some((item) => item.kind === ts.SyntaxKind.StaticKeyword);
}

function dependencyInitialiser(node: ts.Node): ts.Expression | undefined {
  if (!ts.isPropertyDeclaration(node) || !isStatic(node)) return void 0;

  const named = ts.isIdentifier(node.name) && node.name.text === "dependencies";

  return named ? node.initializer : void 0;
}

/** The initialiser of every class's `static dependencies` in this file. */
function dependencyInitialisers(source: ts.SourceFile): ts.Expression[] {
  const found: ts.Expression[] = [];
  const visit = (node: ts.Node): void => {
    const initialiser = dependencyInitialiser(node);
    if (initialiser) found.push(initialiser);

    ts.forEachChild(node, visit);
  };
  visit(source);

  return found;
}

function topLevelConstant({
  source,
  name,
}: {
  source: ts.SourceFile;
  name: string;
}): ts.Expression | undefined {
  for (const statement of source.statements.filter(ts.isVariableStatement)) {
    for (const declaration of statement.declarationList.declarations) {
      if (ts.isIdentifier(declaration.name) && declaration.name.text === name)
        return declaration.initializer;
    }
  }

  return void 0;
}

/** Local name -> module specifier, for every named import in the file. */
function importedNames(source: ts.SourceFile): Map<string, { specifier: string; name: string }> {
  const names = new Map<string, { specifier: string; name: string }>();

  for (const statement of source.statements.filter(ts.isImportDeclaration)) {
    const bindings = statement.importClause?.namedBindings;
    if (!ts.isStringLiteral(statement.moduleSpecifier) || !bindings) continue;
    if (!ts.isNamedImports(bindings)) continue;

    for (const element of bindings.elements) {
      names.set(element.name.text, {
        specifier: statement.moduleSpecifier.text,
        name: (element.propertyName ?? element.name).text,
      });
    }
  }

  return names;
}

function relativeFile({
  from,
  specifier,
}: {
  from: string;
  specifier: string;
}): string | undefined {
  if (!specifier.startsWith(".")) return void 0;

  const path = resolve(dirname(from), specifier);
  const candidates = [path, `${path}.ts`, path.replace(/\.js$/, ".ts")];

  return candidates.find((candidate) => SOURCE_FILE.test(candidate) && existsSync(candidate));
}

/** The object literal a dependency map is, following constants and relative imports. */
function locate({
  expression,
  source,
}: {
  expression: ts.Expression;
  source: ts.SourceFile;
}): Located | undefined {
  const value = unwrap(expression);
  if (ts.isObjectLiteralExpression(value)) return { literal: value, source };
  if (!ts.isIdentifier(value)) return void 0;

  const local = topLevelConstant({ source, name: value.text });
  if (local) return locate({ expression: local, source });

  const imported = importedNames(source).get(value.text);
  const file = imported && relativeFile({ from: source.fileName, specifier: imported.specifier });
  if (!imported || !file) return void 0;

  const target = sourceFile({ file });
  const declared = topLevelConstant({ source: target, name: imported.name });

  return declared ? locate({ expression: declared, source: target }) : void 0;
}

function rootIdentifier(expression: ts.Expression): ts.Identifier | undefined {
  const value = unwrap(expression);
  if (ts.isIdentifier(value)) return value;
  if (ts.isPropertyAccessExpression(value) || ts.isCallExpression(value))
    return rootIdentifier(value.expression);

  return void 0;
}

/** Every token a dependency map names, spreads followed. */
function tokens(located: Located): { token: ts.Identifier; source: ts.SourceFile }[] {
  const found: { token: ts.Identifier; source: ts.SourceFile }[] = [];

  for (const property of located.literal.properties) {
    if (ts.isShorthandPropertyAssignment(property)) {
      found.push({ token: property.name, source: located.source });
      continue;
    }

    const spread = ts.isSpreadAssignment(property)
      ? locate({ expression: property.expression, source: located.source })
      : void 0;
    if (spread) found.push(...tokens(spread));

    const token = ts.isPropertyAssignment(property) ? rootIdentifier(property.initializer) : void 0;
    if (token) found.push({ token, source: located.source });
  }

  return found;
}

/** The feature a package specifier belongs to, by its package name. */
function featureOf({
  specifier,
  features,
}: {
  specifier: string;
  features: ReadonlyMap<string, string>;
}): string | undefined {
  const name = specifier.split("/").slice(0, 2).join("/");

  return features.get(name);
}

function fileEdges({
  file,
  from,
  features,
}: {
  file: string;
  from: string;
  features: ReadonlyMap<string, string>;
}): PeerEdge[] {
  const source = sourceFile({ file });
  const edges: PeerEdge[] = [];

  for (const expression of dependencyInitialisers(source)) {
    const located = locate({ expression, source });

    for (const { token, source: holder } of located ? tokens(located) : []) {
      const imported = importedNames(holder).get(token.text);
      const to = imported && featureOf({ specifier: imported.specifier, features });
      if (!to || to === from) continue;

      const line = holder.getLineAndCharacterOfPosition(token.getStart(holder)).line + 1;
      edges.push({ from, to, file: holder.fileName, line });
    }
  }

  return edges;
}

function edgesOf({
  pkg,
  features,
}: {
  pkg: ClassifiedPackage;
  features: ReadonlyMap<string, string>;
}): PeerEdge[] {
  const from = pkg.feature ?? "";
  const files = listFiles({
    directory: resolve(pkg.root, "src"),
    accept: (file) => SOURCE_FILE.test(file) && !TEST_FILE.test(file),
  }).filter((file) => DECLARES_DEPENDENCIES.test(sourceText({ file })));

  return files.flatMap((file) => fileEdges({ file, from, features }));
}

/** Every peer edge the installed process apps declare, one per module pair. */
export function peerEdges({ packages }: { packages: readonly ClassifiedPackage[] }): PeerEdge[] {
  const features = new Map<string, string>();
  for (const pkg of packages) if (pkg.feature) features.set(pkg.name, pkg.feature);

  const unique = new Map<string, PeerEdge>();

  for (const pkg of packages.filter((item) => item.kind === "process" && item.feature)) {
    for (const edge of edgesOf({ pkg, features })) {
      const key = `${edge.from} -> ${edge.to}`;
      if (!unique.has(key)) unique.set(key, edge);
    }
  }

  return [...unique.values()].toSorted(
    (left, right) => left.from.localeCompare(right.from) || left.to.localeCompare(right.to),
  );
}

/** The shortest path from `start` to `goal` over the edges, or none. */
function shortestPath({
  graph,
  start,
  goal,
}: {
  graph: ReadonlyMap<string, readonly string[]>;
  start: string;
  goal: string;
}): string[] | undefined {
  const previous = new Map<string, string>([[start, start]]);
  const queue = [start];

  for (let index = 0; index < queue.length; index++) {
    const node = queue[index] ?? "";
    if (node === goal) break;

    for (const next of graph.get(node) ?? []) {
      if (previous.has(next)) continue;
      previous.set(next, node);
      queue.push(next);
    }
  }

  if (!previous.has(goal)) return void 0;

  const path = [goal];
  while (path[0] !== start) path.unshift(previous.get(path[0] ?? "") ?? start);

  return path;
}

/** Every peer edge whose peer can reach back to the module that declared it. */
export function peerCycleEdges({
  packages,
}: {
  packages: readonly ClassifiedPackage[];
}): PeerCycleEdge[] {
  const edges = peerEdges({ packages });
  const graph = new Map<string, string[]>();

  for (const edge of edges) graph.set(edge.from, [...(graph.get(edge.from) ?? []), edge.to]);

  return edges.flatMap((edge) => {
    const back = shortestPath({ graph, start: edge.to, goal: edge.from });

    return back ? [{ ...edge, back }] : [];
  });
}

/** A peer dependency that closes a loop is a violation. */
export function lintPeerCycles(snapshot: WorkspaceSnapshot): ArchitectureViolation[] {
  return peerCycleEdges({ packages: snapshot.packages }).map((edge) => ({
    policy: POLICY,
    file: edge.file,
    line: edge.line,
    message: `${edge.from} depends on ${edge.to}'s Api, and ${edge.to} reaches back: ${edge.back.join(" -> ")}.`,
    allowed: ALLOWED,
  }));
}
