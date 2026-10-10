import { join, relative } from "node:path";

import ts from "typescript";

import type { ArchitectureViolation } from "../../types.ts";
import { readRestNamespaceOwners } from "../../workspace/feature-catalogue.ts";
import { sourceFile, sourceText } from "../../workspace/module-graph.ts";
import type { WorkspaceSnapshot } from "../../workspace/snapshot.ts";

/**
 * A REST namespace has one owner, named in modules/catalogue.json; a route another module
 * serves in it declares `.withSharedPath({ owner })` naming that owner (ARCHITECTURE.md §8,
 * R10). Category prefixes are listed nowhere, so any module may serve under them.
 */

const POLICY = "rest-namespace-owners";
const SCANNED = ["modules", "enterprise/modules"];
const REST_TRANSPORT = /\/process\/src\/(?:.+\/)?[^/]+\.rest\.ts$/;
const ROUTE_METHODS = new Set(["get", "post", "put", "patch", "delete"]);
const VERSION_SEGMENT = /^v\d+$/;
const RECORD =
  "See dev/docs/ARCHITECTURE.md §8 and packages/architecture-enforcer/specs/rest-namespace-owners.feature.";

/** One route a REST transport declares, with the namespace its path sits in. */
export type DeclaredRestRoute = {
  method: string;
  path: string;
  namespace: string;
  line: number;
  sharedOwner: string | undefined;
};

type ChainCall = { name: string; call: ts.CallExpression };

/** `defineRestRouter(...)` and every call chained on it, in source order. */
function chainFrom(root: ts.CallExpression): ChainCall[] {
  const calls: ChainCall[] = [];
  let node: ts.Node = root;

  while (ts.isPropertyAccessExpression(node.parent) && ts.isCallExpression(node.parent.parent)) {
    const call = node.parent.parent;
    if (call.expression !== node.parent) break;
    calls.push({ name: node.parent.name.text, call });
    node = call;
  }

  return calls;
}

/** The file's top-level constants, unwrapping `as const`, by name. */
function topLevelConstants(source: ts.SourceFile): Map<string, ts.Expression> {
  const constants = new Map<string, ts.Expression>();

  for (const statement of source.statements) {
    if (!ts.isVariableStatement(statement)) continue;
    for (const declaration of statement.declarationList.declarations) {
      let value = declaration.initializer;
      while (value && (ts.isAsExpression(value) || ts.isSatisfiesExpression(value))) {
        value = value.expression;
      }
      if (ts.isIdentifier(declaration.name) && value) constants.set(declaration.name.text, value);
    }
  }

  return constants;
}

function resolved({
  argument,
  constants,
}: {
  argument: ts.Expression | undefined;
  constants: Map<string, ts.Expression>;
}): ts.Expression | undefined {
  return argument && ts.isIdentifier(argument) ? constants.get(argument.text) : argument;
}

/** The literal text a path argument starts with; a template contributes its head only. */
function pathText(
  argument: ts.Expression | undefined,
): { text: string; whole: boolean } | undefined {
  if (!argument) return undefined;
  if (ts.isStringLiteralLike(argument)) return { text: argument.text, whole: true };
  if (ts.isTemplateExpression(argument)) return { text: argument.head.text, whole: false };

  return undefined;
}

/** The first segment after `/api/`, skipping a version segment, when the text settles it. */
export function restNamespaceOf({
  text,
  whole,
}: {
  text: string;
  whole: boolean;
}): string | undefined {
  if (!text.startsWith("/api/")) return undefined;

  const segments = text.slice("/api/".length).split("/");
  const index = VERSION_SEGMENT.test(segments[0] ?? "") ? 1 : 0;
  const segment = segments[index];
  const settled = whole || segments.length > index + 1;

  return segment && settled && !segment.startsWith(":") ? segment : undefined;
}

function stringProperty({
  object,
  name,
}: {
  object: ts.Expression | undefined;
  name: string;
}): string | undefined {
  if (!object || !ts.isObjectLiteralExpression(object)) return undefined;

  for (const property of object.properties) {
    if (!ts.isPropertyAssignment(property) || !ts.isIdentifier(property.name)) continue;
    if (property.name.text !== name) continue;
    const value = property.initializer;
    if (ts.isStringLiteralLike(value)) return value.text;
  }

  return undefined;
}

type FamilyState = {
  source: ts.SourceFile;
  constants: Map<string, ts.Expression>;
  routes: DeclaredRestRoute[];
  namespace: string | undefined;
  literal: boolean;
};

function stringArgument(call: ts.CallExpression): string | undefined {
  const [first] = call.arguments;
  return first && ts.isStringLiteralLike(first) ? first.text : undefined;
}

function declaredRoute({
  state,
  name,
  call,
}: {
  state: FamilyState;
  name: string;
  call: ts.CallExpression;
}): DeclaredRestRoute | undefined {
  const path = pathText(resolved({ argument: call.arguments[0], constants: state.constants }));
  if (!path) return undefined;

  const namespace = state.literal ? restNamespaceOf(path) : state.namespace;
  if (!namespace) return undefined;

  const at = ts.isPropertyAccessExpression(call.expression) ? call.expression.name : call;
  const line = state.source.getLineAndCharacterOfPosition(at.getStart(state.source)).line + 1;

  return { method: name.toUpperCase(), path: path.text, namespace, line, sharedOwner: undefined };
}

/** Folds one chained call into the family read so far. */
function foldCall({
  state,
  name,
  call,
}: {
  state: FamilyState;
  name: string;
  call: ts.CallExpression;
}): void {
  if (name === "withNamespace") {
    state.namespace = stringArgument(call) ?? state.namespace;
    return;
  }
  if (name === "withAddressing") {
    state.literal = stringArgument(call) === "literal";
    return;
  }
  if (name === "withSharedPath") {
    const route = state.routes.at(-1);
    const object = resolved({ argument: call.arguments[0], constants: state.constants });
    if (route) route.sharedOwner = stringProperty({ object, name: "owner" });
    return;
  }
  if (!ROUTE_METHODS.has(name)) return;

  const route = declaredRoute({ state, name, call });
  if (route) state.routes.push(route);
}

function familyRoutes({
  source,
  chain,
  constants,
}: {
  source: ts.SourceFile;
  chain: ChainCall[];
  constants: Map<string, ts.Expression>;
}): DeclaredRestRoute[] {
  const state: FamilyState = {
    source,
    constants,
    routes: [],
    namespace: undefined,
    literal: false,
  };
  for (const { name, call } of chain) foldCall({ state, name, call });

  return state.routes;
}

/** Every route a REST transport file declares whose namespace its source settles. */
export function declaredRestRoutes(file: string): DeclaredRestRoute[] {
  if (!sourceText({ file }).includes("defineRestRouter")) return [];

  const source = sourceFile({ file });
  const constants = topLevelConstants(source);
  const routes: DeclaredRestRoute[] = [];
  const visit = (node: ts.Node): void => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      node.expression.text === "defineRestRouter"
    ) {
      routes.push(...familyRoutes({ source, chain: chainFrom(node), constants }));
    }
    ts.forEachChild(node, visit);
  };
  visit(source);

  return routes;
}

function finding({
  file,
  route,
  server,
  owner,
}: {
  file: string;
  route: DeclaredRestRoute;
  server: string;
  owner: string | undefined;
}): ArchitectureViolation | undefined {
  const where = `${route.method} ${route.path} of ${server}`;
  const shared = route.sharedOwner;

  if (owner === server || (owner === undefined && shared === undefined)) {
    return shared === undefined
      ? undefined
      : {
          policy: POLICY,
          file,
          line: route.line,
          message: `${where} declares a shared path with ${shared}, but ${server} owns the REST namespace "${route.namespace}".`,
          allowed: `Drop .withSharedPath from this route. ${RECORD}`,
        };
  }

  if (owner === undefined) {
    return {
      policy: POLICY,
      file,
      line: route.line,
      message: `${where} declares a shared path with ${shared}, but no module owns the REST namespace "${route.namespace}" in modules/catalogue.json.`,
      allowed: `Drop .withSharedPath, or list "${route.namespace}" in ${shared}'s restNamespaces if ${shared} owns it. ${RECORD}`,
    };
  }

  if (shared === owner) return undefined;

  return {
    policy: POLICY,
    file,
    line: route.line,
    message:
      shared === undefined
        ? `${where} sits in the REST namespace "${route.namespace}", which ${owner} owns (modules/catalogue.json).`
        : `${where} declares a shared path with ${shared}, but ${owner} owns the REST namespace "${route.namespace}".`,
    allowed: `Declare .withSharedPath({ owner: "${owner}", reason, deprecate }) on the route (a literal family, or a dated family whose every route shares), or move it under a namespace ${server} owns. ${RECORD}`,
  };
}

/** Holds every REST route to the catalogue's namespace owners. */
export function lintRestNamespaceOwners(snapshot: WorkspaceSnapshot): ArchitectureViolation[] {
  const owners = readRestNamespaceOwners({ workspaceRoot: snapshot.root });
  const files = SCANNED.flatMap((directory) =>
    snapshot.files({
      directory: join(snapshot.root, directory),
      accept: (path) => REST_TRANSPORT.test(path) && !path.includes("/__tests__/"),
    }),
  );

  return files.flatMap((file) => {
    const path = relative(snapshot.root, file);
    const server = snapshot.catalogue.find((entry) => path.startsWith(`${entry.root}/`))?.id;
    if (!server) return [];

    return declaredRestRoutes(file).flatMap((route) => {
      const violation = finding({ file, route, server, owner: owners.get(route.namespace) });
      return violation ? [violation] : [];
    });
  });
}
