import { join, relative, sep } from "node:path";

import ts from "typescript";

import type { ArchitectureViolation } from "../../types.ts";
import { mentionMatcher, sourceFile } from "../../workspace/module-graph.ts";
import type { WorkspaceSnapshot } from "../../workspace/snapshot.ts";

/**
 * Rule 3 of dev/docs/plans/platform-architecture-blocks.md: a screen's address belongs to the
 * module whose `*.web.ts` declares it; a peer's literal breaks silently when the owner moves it.
 * Shrink-only: tests/baselines/peer-route-literal.json holds today's count per file and route.
 */

export const PEER_ROUTE_LITERAL_POLICY = "peer-route-literal";
export const PEER_ROUTE_LITERAL_RATCHET =
  "packages/architecture-enforcer/tests/baselines/peer-route-literal.json";

const MODULE_TREES = ["modules", "enterprise/modules"] as const;
const SCANNED_TREES = ["modules", "enterprise/modules", "apps"] as const;
const SOURCE_FILE = /\.[cm]?tsx?$/;
const WEB_FILE = /\.web\.ts$/;
const TEST_FILE =
  /(?:__tests__|__fixtures__|__mocks__|\/fixtures\/|\/e2e\/|\.(?:test|spec|stories|fixture)\.)/;
const GENERATED = /(?:^|\/)generated\/|\.generated\./;
/** The haven dashboard is its own product with its own `/settings`; none of its routes are ours. */
const OTHER_PRODUCTS = /^apps\/haven-web\//;
/** Stands for one `${...}` substitution inside a template literal's text. */
const HOLE = "\u0000";

/** One screen address a module declares, split into its segments (`:x` is a parameter). */
export type OwnedRoute = { path: string; owner: string; segments: readonly string[] };

/** A literal that spells a peer's screen address. */
export type PeerRouteLiteral = { file: string; line: number; route: OwnedRoute; text: string };

function workspacePath({ root, file }: { root: string; file: string }): string {
  return relative(root, file).split(sep).join("/");
}

/** `modules/<m>` or `enterprise/modules/<m>` for a repo-relative path; undefined outside both. */
export function moduleRootOf(path: string): string | undefined {
  const match = /^(modules\/[^/]+|enterprise\/modules\/[^/]+)\//.exec(path);

  return match?.[1];
}

const isParameter = (segment: string): boolean => segment.startsWith(":");

/**
 * Whether a declared address is specific enough to own. `/` and `/:project` name nothing a
 * peer could restate; a one-segment address (`/me`, `/settings`) is owned, but matched exactly.
 */
function isOwnable(segments: readonly string[]): boolean {
  return segments.some((segment) => segment !== "" && !isParameter(segment));
}

function segmentsOf(path: string): string[] {
  return path.split("/").slice(1);
}

function stringValue(node: ts.Expression | undefined): string | undefined {
  if (node === undefined) return void 0;
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;

  return void 0;
}

/** Every `path: "/..."` a module's `*.web.ts` declares, with the module that owns it. */
export function collectOwnedRoutes(snapshot: WorkspaceSnapshot): OwnedRoute[] {
  const { root } = snapshot;
  const routes: OwnedRoute[] = [];

  for (const tree of MODULE_TREES) {
    const files = snapshot.files({
      directory: join(root, tree),
      accept: (file) => WEB_FILE.test(file) && !TEST_FILE.test(file),
    });

    for (const file of files) {
      const owner = moduleRootOf(workspacePath({ root, file }));
      if (owner !== undefined) routes.push(...routesDeclaredIn({ file, owner }));
    }
  }

  return routes;
}

/** The ownable route a `path: "/..."` property declares, or undefined for any other node. */
function routeDeclaredBy({
  node,
  owner,
}: {
  node: ts.Node;
  owner: string;
}): OwnedRoute | undefined {
  if (!ts.isPropertyAssignment(node) || !ts.isIdentifier(node.name)) return void 0;
  if (node.name.text !== "path") return void 0;
  const path = stringValue(node.initializer);
  if (path?.startsWith("/") !== true) return void 0;
  const segments = segmentsOf(path);

  return isOwnable(segments) ? { path, owner, segments } : void 0;
}

function routesDeclaredIn({ file, owner }: { file: string; owner: string }): OwnedRoute[] {
  const routes: OwnedRoute[] = [];
  const visit = (node: ts.Node): void => {
    const route = routeDeclaredBy({ node, owner });
    if (route) routes.push(route);
    ts.forEachChild(node, visit);
  };
  visit(sourceFile({ file, parents: false }));

  return routes;
}

/** A literal's text with each substitution as one HOLE; undefined for anything else. */
function literalText(node: ts.Node): string | undefined {
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node.text;
  if (!ts.isTemplateExpression(node)) return void 0;

  return node.head.text + node.templateSpans.map((span) => HOLE + span.literal.text).join("");
}

function segmentMatches({ route, literal }: { route: string; literal: string }): boolean {
  return isParameter(route) ? literal.includes(HOLE) : route === literal;
}

/**
 * Whether the literal is the route, or the route followed by `/`, `?` or `#`. A one-segment
 * route matches only exactly (query and fragment allowed): `/settings/<x>` is some other screen.
 */
export function spellsRoute({ text, route }: { text: string; route: OwnedRoute }): boolean {
  if (!text.startsWith("/")) return false;

  const address = text.split(/[?#]/, 1)[0]!;
  const literal = segmentsOf(address.length > 1 ? address.replace(/\/$/, "") : address);
  const { segments } = route;
  if (literal.length < segments.length) return false;
  if (literal.length > segments.length && segments.length === 1) return false;

  return segments.every((segment, at) => segmentMatches({ route: segment, literal: literal[at]! }));
}

/** The most specific route the literal spells: longest first, so `/a/b` beats `/a`. */
function routeSpelled({
  text,
  routes,
}: {
  text: string;
  routes: readonly OwnedRoute[];
}): OwnedRoute | undefined {
  return routes.find((route) => spellsRoute({ text, route }));
}

function lineOf({ source, node }: { source: ts.SourceFile; node: ts.Node }): number {
  return source.getLineAndCharacterOfPosition(node.getStart(source)).line + 1;
}

/** Every literal outside a route's owner that spells the owner's screen address. */
export function collectPeerRouteLiterals(snapshot: WorkspaceSnapshot): PeerRouteLiteral[] {
  const { root } = snapshot;
  const routes = collectOwnedRoutes(snapshot).toSorted(
    (left, right) => right.segments.length - left.segments.length,
  );
  if (routes.length === 0) return [];

  const words = new Set(
    routes.map((route) => `/${route.segments.find((segment) => !isParameter(segment))}`),
  );
  const mayName = mentionMatcher({ words });
  const found: PeerRouteLiteral[] = [];

  for (const tree of SCANNED_TREES) {
    const files = snapshot.files({
      directory: join(root, tree),
      accept: (file) => SOURCE_FILE.test(file) && !TEST_FILE.test(file) && !GENERATED.test(file),
    });

    for (const file of files) {
      if (!mayName(file)) continue;

      const path = workspacePath({ root, file });
      if (!OTHER_PRODUCTS.test(path)) found.push(...peerLiteralsIn({ file, path, routes }));
    }
  }

  return found;
}

/** Every literal in one file that spells a route some other module owns. */
function peerLiteralsIn({
  file,
  path,
  routes,
}: {
  file: string;
  path: string;
  routes: readonly OwnedRoute[];
}): PeerRouteLiteral[] {
  const home = moduleRootOf(path);
  const source = sourceFile({ file, parents: false });
  const found: PeerRouteLiteral[] = [];
  const visit = (node: ts.Node): void => {
    const text = literalText(node);
    if (text === undefined) {
      ts.forEachChild(node, visit);

      return;
    }
    const route = routeSpelled({ text, routes });
    if (route !== undefined && route.owner !== home)
      found.push({ file: path, line: lineOf({ source, node }), route, text });
  };
  visit(source);

  return found;
}

/** The shrink-only list's key: the file and the peer address it spells. */
export function peerRouteLiteralKey(finding: PeerRouteLiteral): string {
  return `${finding.file}|${finding.route.path}`;
}

export function lintPeerRouteLiterals(snapshot: WorkspaceSnapshot): ArchitectureViolation[] {
  return collectPeerRouteLiterals(snapshot).map((finding) => ({
    policy: PEER_ROUTE_LITERAL_POLICY,
    file: finding.file,
    line: finding.line,
    specifier: finding.route.path,
    message: `This literal spells \`${finding.route.path}\`, a screen ${finding.route.owner} declares in its *.web.ts; the day ${finding.route.owner} moves the screen this link breaks without a type error.`,
    allowed: `Build the address with ${finding.route.owner}'s exported href builder, or ask ${finding.route.owner} to export one. Each count in ${PEER_ROUTE_LITERAL_RATCHET} may fall, never rise.`,
  }));
}
