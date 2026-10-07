/** @vitest-environment node */

/**
 * ADR-144 block C: the store client applies the proof.
 *
 * A converted repository writes a `{{tenantScope:<Col>}}` marker and the
 * `AuthorizedClickHouse` reader expands it into the only tenant predicate the
 * statement carries. The reader refuses a statement that names the tenant
 * itself, so a hand-written predicate fails at run time - but only on the
 * path a test happens to drive. A repository method that resolves the
 * tenant's own client by id and writes `WHERE TenantId = {tenantId:String}`
 * never meets the reader at all: it reads exactly the project it was handed,
 * every shared grant on an aggregate contributes nothing, and nothing fails.
 * That gap fails OPEN in the sense that matters here: the aggregate silently
 * shows less than the proof allows, and a route that skipped the proof reads
 * with no fence at all.
 *
 * This gate makes both unwriteable from the source: every converted
 * repository reads through the client, no converted read names the tenant
 * in a predicate, the fragment expander keeps its one caller, and every
 * trace route that reaches a converted read carries a proof.
 *
 * The gate reads what the code does, not what it is called. A method is a
 * write because this file lists it, not because its name starts with
 * `delete`; a class arrow property is a method; taking hold of the resolver
 * without calling it counts; a client factory reached past the injected
 * resolver counts anywhere; and a comment that says "authorization" is not a
 * proof.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import type { Node, SourceFile } from "typescript/unstable/ast";
import {
  isArrowFunction,
  isAwaitExpression,
  isBinaryExpression,
  isBindingElement,
  isCallExpression,
  isClassLikeDeclaration,
  isConstructorDeclaration,
  isElementAccessExpression,
  isFunctionDeclaration,
  isFunctionExpression,
  isGetAccessorDeclaration,
  isIdentifier,
  isImportDeclaration,
  isImportSpecifier,
  isMethodDeclaration,
  isNamedImports,
  isNoSubstitutionTemplateLiteral,
  isObjectBindingPattern,
  isObjectLiteralExpression,
  isParameterDeclaration,
  isPrivateIdentifier,
  isPropertyAccessExpression,
  isPropertyAssignment,
  isPropertyDeclaration,
  isQualifiedName,
  isSetAccessorDeclaration,
  isSourceFile,
  isStringLiteral,
  isTemplateExpression,
  isVariableDeclaration,
  isVariableDeclarationList,
  isVariableStatement,
  SyntaxKind,
} from "typescript/unstable/ast";
import { describe, expect, it } from "vitest";
import { parseSourceText, parseSourceTexts } from "~/test-utils/tsAst";
import { HAND_WRITTEN_TENANT_PREDICATE } from "../authorized-reads";

const SRC = path.resolve(import.meta.dirname, "../../../../..");
const APP = path.resolve(SRC, "..");

/** The repositories rungs C1 to C5 converted to read through the client. */
const CONVERTED_REPOSITORIES = [
  "server/app-layer/traces/repositories/trace-list.clickhouse.repository.ts",
  "server/app-layer/traces/repositories/trace-summary.clickhouse.repository.ts",
  "server/app-layer/traces/repositories/span-storage.clickhouse.repository.ts",
  "server/app-layer/traces/repositories/trace-analytics.clickhouse.repository.ts",
  "server/app-layer/traces/repositories/session-groups.clickhouse.repository.ts",
  "server/app-layer/evaluations/repositories/evaluation-run.clickhouse.repository.ts",
  "server/app-layer/evaluations/repositories/trace-evaluations.clickhouse.repository.ts",
];

/**
 * The write methods of each converted repository: the only places that may
 * resolve a tenant's own client, because a write carries no proof. Listed
 * by name, not by prefix: a read called `deleteStaleAndFind` is a read. A
 * listed method that disappears, or that stops resolving a client, fails
 * the gate so the list stays true.
 */
const WRITE_METHODS: Record<string, string[]> = {
  "server/app-layer/traces/repositories/trace-summary.clickhouse.repository.ts":
    ["upsert", "upsertBatch"],
  "server/app-layer/traces/repositories/span-storage.clickhouse.repository.ts":
    ["insertSpan", "insertSpans"],
  "server/app-layer/traces/repositories/trace-analytics.clickhouse.repository.ts":
    ["upsert", "upsertBatch"],
  "server/app-layer/evaluations/repositories/evaluation-run.clickhouse.repository.ts":
    ["upsert", "upsertBatch"],
};

/**
 * Methods of a converted repository that still resolve the tenant's own
 * client by id and write their own predicate. Each entry names the block
 * that converts it together with its callers; the entry leaves this list in
 * the same change. A stale entry fails the gate, so the list can only shrink.
 */
const NOT_YET_CONVERTED: Array<{
  file: string;
  method: string;
  reason: string;
  owner: string;
}> = [
  {
    file: "server/app-layer/evaluations/repositories/trace-evaluations.clickhouse.repository.ts",
    method: "findManyByTraceIdsForTenant",
    reason:
      "the REST trace surfaces, the share link and the evaluation worker still hand a project id to TraceService.getEvaluationsMultiple; the drawer reads through findManyByTraceIds and the proof.",
    owner: "follow-up to block F",
  },
];

function notYetConvertedMethodsOf(file: string): string[] {
  return NOT_YET_CONVERTED.filter((entry) => entry.file === file).map(
    (entry) => entry.method,
  );
}

/** The methods of a converted repository allowed to reach a tenant's client. */
function clientHoldersOf(file: string): string[] {
  return [...(WRITE_METHODS[file] ?? []), ...notYetConvertedMethodsOf(file)];
}

/**
 * The modules allowed to expand a WHERE fragment outside a statement: the one
 * legacy raw-client caller the ADR names, and the test helper that mints the
 * same expansion for assertions.
 */
const FRAGMENT_EXPANDER_CALLERS = new Set([
  "src/app/api/traces/[[...route]]/trace-filter.ts",
  "src/test-utils/authorizationProofs.ts",
]);

/**
 * Where trace routes live: the tRPC routers, the legacy Hono routes and the
 * REST app. Every gate below reads all three, so a route reaching a trace
 * read is checked wherever it is written.
 */
const ROUTE_ROOTS = ["server/api/routers", "server/routes", "app/api"];

/** The routes whose reads reach a converted repository. */
const TRACE_ROUTERS = [
  "app/api/traces/[[...route]]/app.v1.ts",
  "server/api/routers/llmModelCosts.ts",
  "server/api/routers/sharedTrace.ts",
  "server/api/routers/traceEditOverlay.ts",
  "server/api/routers/traces.ts",
  "server/api/routers/tracesV2.ts",
];

/**
 * The services whose repository reads through the proof: the trace list,
 * summary, spans and session groups services under `traces`, and the
 * evaluation runs service under `evaluations` that owns the evaluation
 * summaries. A call into one, or a hand-over of one, reaches a converted
 * read.
 */
const PROOF_TAKING_SERVICES = new Map<string, string[]>([
  ["traces", ["list", "summary", "spans", "sessionGroups"]],
  ["evaluations", ["runs"]],
]);

/**
 * Narrowing the detail proof reaches the summary service too, so a router
 * that only calls this reaches a converted read as surely.
 */
const DETAIL_PROOF_NARROWER = "traceDetailAuthorization";

/**
 * Router chunks that reach one of those services and carry no proof. Every
 * other such chunk mints one with `requireRouteAuthorization(ctx)` or
 * receives one as a parameter. An entry here names the block that converts
 * it and leaves with it; the gate fails if the chunk gains a proof, so the
 * list can only shrink.
 */
const ROUTE_CHUNKS_WITHOUT_PROOF: Array<{
  file: string;
  chunk: string;
  reason: string;
  owner: string;
}> = [];

/**
 * Trace reads a route still hands a tenant by hand, kept behind the
 * baseline on purpose. Each entry names the route, the service, how many
 * references it holds today, the owner and the reason. A route that gains
 * a reference fails; one that loses its last, or drops below the count,
 * fails as stale, so the list can only shrink. This list is the answer to
 * ADR-144's open question on which trace reads take the proof in v1.
 *
 * `TraceService`, `EvaluationService` and `ClickHouseTraceService` take a
 * project id for every trace read they make, so a route that imports one
 * hands a tenant by hand however it calls it. None of them is reachable
 * with an aggregate's data: the REST routes and the share link resolve a
 * project from an API key or a share token, which an aggregate never has,
 * and an aggregate's own id holds no member's rows.
 */
const HAND_TENANT_READS: Array<{
  file: string;
  service: string;
  references: number;
  reason: string;
  owner: string;
}> = [
  {
    file: "server/api/routers/tracesV2.ts",
    service: "traces.logRecords",
    references: 3,
    reason:
      "log_records and its canonical table window on TimeUnixMs, which is not one of the client's time columns; admitting a fifth is the decision ADR-144 v4.2 leaves open. On an aggregate the logs read the aggregate's own tenant and find none.",
    owner: "decision pending (fifth time column)",
  },
  {
    file: "server/api/routers/tracesV2.ts",
    service: "codingAgents.sessions",
    references: 1,
    reason:
      "the coding-agent session tables have no proof-reading repository yet; on an aggregate the Session view finds no session for a member trace.",
    owner: "follow-up to block F",
  },
  {
    file: "app/api/coding-agent/[[...route]]/app.ts",
    service: "codingAgents.sessions",
    references: 1,
    reason:
      "the coding-agent REST route reads one session's events for the API key's project; an aggregate has no API key, and the session tables have no proof-reading repository yet.",
    owner: "follow-up to block F (coding-agent sessions)",
  },
  {
    file: "server/api/routers/codingAgents.ts",
    service: "codingAgents.sessions",
    references: 2,
    reason:
      "the coding-agent usage totals and recent sessions read the URL project; on an aggregate they read its own tenant and find none, the same gap as the Session view.",
    owner: "follow-up to block F (coding-agent sessions)",
  },
  {
    file: "app/api/traces/[[...route]]/app.v1.ts",
    service: "TraceService",
    references: 4,
    reason:
      "the REST v1 trace reads (get, list, search with evaluations) take the API key's project; an aggregate has no API key, so these never read one.",
    owner: "follow-up to block F (REST surfaces)",
  },
  {
    file: "server/api/routers/annotation.ts",
    service: "ClickHouseTraceService",
    references: 3,
    reason:
      "annotation queues check that trace ids exist in the queue's own project; an annotation queue is never created on an aggregate.",
    owner: "follow-up to block F (annotations)",
  },
  {
    file: "server/api/routers/annotation.ts",
    service: "TraceService",
    references: 2,
    reason:
      "annotation rows decorate their traces from the queue's own project; an annotation queue is never created on an aggregate.",
    owner: "follow-up to block F (annotations)",
  },
  {
    file: "server/api/routers/sharedTrace.ts",
    service: "TraceService",
    references: 2,
    reason:
      "the share link's evaluations read the shared trace's own project through TraceService.getEvaluationsMultiple; a share link is minted on one project, never on an aggregate.",
    owner: "follow-up to block F (share link)",
  },
  {
    file: "server/api/routers/spans.ts",
    service: "TraceService",
    references: 3,
    reason:
      "the v1 span reads hand the URL project to TraceService; on an aggregate they read the aggregate's own tenant and find none. The drawer reads spans through tracesV2.",
    owner: "follow-up to block F (v1 trace router)",
  },
  {
    file: "server/api/routers/traces.ts",
    service: "TraceService",
    references: 16,
    reason:
      "the v1 trace router's other procedures (getById, getAllForProject, getEvaluationsMultiple, the thread, topic, sample and download reads) hand the URL project to TraceService; on an aggregate they find none. getEvaluations and getEvaluationInputs, the two the drawer calls, read through the proof since block F.",
    owner: "follow-up to block F (v1 trace router)",
  },
  {
    file: "server/routes/traces-legacy.ts",
    service: "TraceService",
    references: 4,
    reason:
      "the legacy REST trace routes take the API key's project; an aggregate has no API key, so these never read one.",
    owner: "follow-up to block F (REST surfaces)",
  },
];

/** Services whose reads take a tenant by hand; see {@link HAND_TENANT_READS}. */
const HAND_TENANT_MEMBERS = new Set([
  "traces.logRecords",
  "codingAgents.sessions",
]);

/** The services that take a project id for every trace read. */
const HAND_TENANT_CLASSES = new Set([
  "TraceService",
  "EvaluationService",
  "ClickHouseTraceService",
]);

function read(relativeToSrc: string): string {
  return readFileSync(path.join(SRC, relativeToSrc), "utf8");
}

/**
 * Parses sources through the one compiler session, all in a single exchange,
 * keyed by the name each was read under. Every check below walks the parsed
 * tree, so a comment is never code: it is trivia, and no walk visits it.
 */
function parseAll({
  files,
  readText,
}: {
  files: readonly string[];
  readText: (file: string) => string;
}): Map<string, SourceFile> {
  const parsed = parseSourceTexts({
    sources: files.map((file) => ({
      fileName: file,
      sourceText: readText(file),
    })),
  });
  return new Map(parsed.map(({ fileName, source }) => [fileName, source]));
}

/** A fixture's lines, parsed the way a real source is. */
function parseFixture(lines: readonly string[]): SourceFile {
  return parseSourceText({
    fileName: "fixture.ts",
    sourceText: lines.join("\n"),
  });
}

/** 1-based line of the first character of `node`, its leading trivia skipped. */
function lineOf(tree: SourceFile, node: Node): number {
  return tree.text.slice(0, node.getStart(tree)).split("\n").length;
}

/**
 * Calls `visit` on `root` and every node below it, in source order. A node
 * `visit` answers false for is not entered.
 */
function walk(root: Node, visit: (node: Node) => boolean): void {
  if (!visit(root)) return;
  root.forEachChild((child) => {
    walk(child, visit);
  });
}

/** Every node from `root` down that `matches` accepts, never entering a node `stop` names. */
function findNodes({
  root,
  matches,
  stop = () => false,
}: {
  root: Node;
  matches: (node: Node) => boolean;
  stop?: (node: Node) => boolean;
}): Node[] {
  const found: Node[] = [];
  walk(root, (node) => {
    if (node !== root && stop(node)) return false;
    if (matches(node)) found.push(node);
    return true;
  });
  return found;
}

function isIdentifierNamed(node: Node, name: string): boolean {
  return isIdentifier(node) && node.text === name;
}

/** The last name of an access path: `traces` for `getApp().traces`. */
function lastNameOf(node: Node): Node | undefined {
  if (isIdentifier(node)) return node;
  if (isPropertyAccessExpression(node)) return node.name;
  if (isQualifiedName(node)) return node.right;
  return undefined;
}

/**
 * The owner and member a member access ends in, `traces.spans` for
 * `getApp().traces.spans`, with the owner's own name node for its line.
 * A type query (`typeof app.traces.spans`) reads the same as an expression.
 */
function memberAccessOf(
  node: Node,
): { owner: Node; label: string } | undefined {
  const [object, member] = isPropertyAccessExpression(node)
    ? [node.expression, node.name]
    : isQualifiedName(node)
      ? [node.left, node.right]
      : [undefined, undefined];
  const owner = object && lastNameOf(object);
  if (!owner || !isIdentifier(owner) || !isIdentifier(member)) return undefined;
  return { owner, label: `${owner.text}.${member.text}` };
}

/** Whether `node` names a service whose repository reads through the proof. */
function isProofTakingService(node: Node): boolean {
  const access = memberAccessOf(node);
  if (!access) return false;
  const [owner, member] = access.label.split(".") as [string, string];
  return PROOF_TAKING_SERVICES.get(owner)?.includes(member) ?? false;
}

/**
 * A call into, or a hand-over of, a service whose repository reads through
 * the proof. Importing the detail proof's narrower is neither: the chunk
 * that calls it is.
 */
function reachesConvertedRead(node: Node): boolean {
  return (
    isProofTakingService(node) ||
    (isIdentifierNamed(node, DETAIL_PROOF_NARROWER) &&
      !isImportSpecifier(node.parent))
  );
}

/** The proof, named in code: a binding, a property or an argument called `authorization`. */
function isProof(node: Node): boolean {
  return isIdentifierNamed(node, "authorization");
}

/**
 * Every string literal in a source, or under one node of it, with the offset
 * of its first character, its text read raw so a line of it is a line of the
 * file. A template literal is returned whole, `${}` expressions included, so
 * a nested template never splits the SQL around it.
 */
function stringLiteralsIn({
  tree,
  root = tree,
}: {
  tree: SourceFile;
  root?: Node;
}): Array<{ text: string; offset: number }> {
  const found: Array<{ text: string; offset: number }> = [];
  walk(root, (node) => {
    const isLiteral =
      isStringLiteral(node) ||
      isNoSubstitutionTemplateLiteral(node) ||
      isTemplateExpression(node);
    if (!isLiteral) return true;
    const offset = node.getStart(tree) + 1;
    found.push({ text: tree.text.slice(offset, node.end - 1), offset });
    return false;
  });
  return found;
}

type Method = { name: string; node: Node; start: number; end: number };

/** The name a class member is called by, if it is a method. */
function methodNameOf(member: Node): string | undefined {
  if (isConstructorDeclaration(member)) return "constructor";
  const isFunctionProperty =
    isPropertyDeclaration(member) &&
    member.initializer !== undefined &&
    (isArrowFunction(member.initializer) ||
      isFunctionExpression(member.initializer));
  const isMethod =
    isMethodDeclaration(member) ||
    isGetAccessorDeclaration(member) ||
    isSetAccessorDeclaration(member) ||
    isFunctionProperty;
  if (!isMethod) return undefined;
  const name = member.name;
  return isIdentifier(name) ||
    isPrivateIdentifier(name) ||
    isStringLiteral(name)
    ? name.text
    : undefined;
}

/**
 * The methods of every class in a source, each spanning its own declaration:
 * method declarations, accessors, the constructor, and arrow or function
 * properties, since a class arrow property is a method.
 */
function methodsOf(tree: SourceFile): Method[] {
  const methods: Method[] = [];
  walk(tree, (node) => {
    if (!isClassLikeDeclaration(node)) return true;
    for (const member of node.members) {
      const name = methodNameOf(member);
      if (name === undefined) continue;
      methods.push({
        name,
        node: member,
        start: member.getStart(tree),
        end: member.end,
      });
    }
    return true;
  });
  return methods;
}

/** The innermost method spanning `offset`. */
function methodAt(methods: Method[], offset: number): Method | undefined {
  return methods
    .filter((method) => offset >= method.start && offset < method.end)
    .at(-1);
}

/**
 * Every query-text line of a repository that names the tenant in a predicate
 * of its own, as `file:line text`, with the not-yet-converted methods left
 * out. `root` narrows the scan to one node of the source. This is the
 * function the fixture check drives, so the two agree.
 */
function handWrittenTenantPredicatesIn({
  file,
  tree,
  root = tree,
  skipMethods = [],
}: {
  file: string;
  tree: SourceFile;
  root?: Node;
  skipMethods?: string[];
}): string[] {
  const methods = methodsOf(tree);
  const offending: string[] = [];
  for (const literal of stringLiteralsIn({ tree, root })) {
    const method = methodAt(methods, literal.offset);
    if (method && skipMethods.includes(method.name)) continue;
    const firstLine = tree.text.slice(0, literal.offset).split("\n").length;
    literal.text.split("\n").forEach((line, index) => {
      if (!HAND_WRITTEN_TENANT_PREDICATE.test(line)) return;
      offending.push(`${file}:${firstLine + index} ${line.trim()}`);
    });
  }
  return offending;
}

/** The injected resolver, and the client factories it stands in front of. */
const CLIENT_RESOLVER = /^(?:resolveClient|getClickHouseClientFor\w+)$/;

/**
 * Every name of the resolver or a client factory in a source: an identifier,
 * or a string key that reaches one through an element access.
 */
function resolverMentionsIn(root: Node): Array<{ name: string; node: Node }> {
  return findNodes({
    root,
    matches: (node) =>
      (isIdentifier(node) && CLIENT_RESOLVER.test(node.text)) ||
      (isStringLiteral(node) &&
        isElementAccessExpression(node.parent) &&
        node.parent.argumentExpression === node &&
        CLIENT_RESOLVER.test(node.text)),
  }).map((node) => ({
    name: isIdentifier(node) || isStringLiteral(node) ? node.text : "",
    node,
  }));
}

/** Whether `name` is the callee of a call, reached directly or as a member. */
function isCalled(name: Node): boolean {
  const parent = name.parent;
  const isMember =
    (isPropertyAccessExpression(parent) && parent.name === name) ||
    (isElementAccessExpression(parent) && parent.argumentExpression === name);
  const callee = isMember ? parent : name;
  return isCallExpression(callee.parent) && callee.parent.expression === callee;
}

const FIELD_MODIFIERS = new Set<SyntaxKind>([
  SyntaxKind.ReadonlyKeyword,
  SyntaxKind.PrivateKeyword,
  SyntaxKind.ProtectedKeyword,
  SyntaxKind.PublicKeyword,
]);

/** Whether `name` is a class field declaring its type, `private readonly x: T`. */
function isTypedFieldName(name: Node): boolean {
  const field = name.parent;
  return (
    isPropertyDeclaration(field) &&
    field.name === name &&
    field.type !== undefined &&
    (field.modifiers ?? []).some((modifier) =>
      FIELD_MODIFIERS.has(modifier.kind),
    )
  );
}

/** What one mention of the resolver or a factory amounts to, if anything. */
function reachOf({
  file,
  tree,
  mention,
  methods,
  allowedMethods,
}: {
  file: string;
  tree: SourceFile;
  mention: { name: string; node: Node };
  methods: Method[];
  allowedMethods: string[];
}): string | undefined {
  const line = lineOf(tree, mention.node);
  if (mention.name !== "resolveClient") {
    return `${file}:${line} reaches ${mention.name} past the injected resolver`;
  }
  const method = methodAt(methods, mention.node.getStart(tree));
  const where = method?.name ?? "<outside any method>";
  if (allowedMethods.includes(where)) return undefined;
  if (isCalled(mention.node)) {
    return `${file}:${line} resolves a tenant's client in ${where}`;
  }
  if (method?.name === "constructor" || isTypedFieldName(mention.node)) {
    return undefined;
  }
  return `${file}:${line} takes hold of the resolver in ${where}`;
}

/**
 * Every place a repository reaches a tenant's own client, as `file:line
 * what`, outside the methods allowed to. A call of the resolver counts; so
 * does taking hold of it without calling, since the call then happens under
 * another name. A client factory counts wherever it appears, in an import or
 * a call: a converted repository resolves clients only through the resolver
 * it was handed. The constructor may store the resolver and a field may
 * declare its type; neither may call it.
 */
function clientReachesIn({
  file,
  tree,
  allowedMethods,
}: {
  file: string;
  tree: SourceFile;
  allowedMethods: string[];
}): string[] {
  const methods = methodsOf(tree);
  return resolverMentionsIn(tree).flatMap((mention) => {
    const reach = reachOf({ file, tree, mention, methods, allowedMethods });
    return reach ? [reach] : [];
  });
}

/** How many calls under `root` call a function of this name, directly or as a member. */
function callsNamed(root: Node, name: string): number {
  return findNodes({
    root,
    matches: (node) => isIdentifierNamed(node, name) && isCalled(node),
  }).length;
}

/** Whether anything under `root` calls the injected resolver. */
function callsResolver(root: Node): boolean {
  return callsNamed(root, "resolveClient") > 0;
}

/** Every `.ts`/`.tsx` under `dir`, as paths relative to `APP`. */
function sourceFilesUnder(dir: string): string[] {
  const files: string[] = [];
  const walkDir = (current: string) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walkDir(full);
      else if (/\.tsx?$/.test(entry.name)) files.push(path.relative(APP, full));
    }
  };
  walkDir(dir);
  return files;
}

function isTestFile(file: string): boolean {
  return /\.test\.tsx?$/.test(file) || file.includes("/__tests__/");
}

/** The names a source imports by name, under their exported name and their local one. */
function namedImportsOf(tree: SourceFile): Set<string> {
  const names = tree.statements.flatMap((statement) => {
    const bindings = isImportDeclaration(statement)
      ? statement.importClause?.namedBindings
      : undefined;
    if (!bindings || !isNamedImports(bindings)) return [];
    return bindings.elements.flatMap((element) =>
      [element.name, element.propertyName].map((name) => name?.text),
    );
  });
  return new Set(names.filter((name) => name !== undefined));
}

type Chunk = {
  name: string;
  line: number;
  reachesConvertedRead: boolean;
  carriesProof: boolean;
};

/** The procedure a handler function belongs to, if it is one: `.query(` / `.mutation(`. */
function procedureNameOf(tree: SourceFile, node: Node): string | undefined {
  const opener = procedureOpenerOf(node);
  if (!opener) return undefined;
  let owner: Node = opener;
  while (!isSourceFile(owner) && !isPropertyAssignment(owner))
    owner = owner.parent;
  return isPropertyAssignment(owner) && isIdentifier(owner.name)
    ? `procedure ${owner.name.text}`
    : `procedure at ${lineOf(tree, opener)}`;
}

/** The `query` / `mutation` name a handler function is handed to, if it is one. */
function procedureOpenerOf(node: Node): Node | undefined {
  const isHandler = isArrowFunction(node) || isFunctionExpression(node);
  const call = node.parent;
  if (!isHandler || !isCallExpression(call) || call.arguments[0] !== node) {
    return undefined;
  }
  const opener = isPropertyAccessExpression(call.expression)
    ? call.expression.name
    : undefined;
  return opener?.text === "query" || opener?.text === "mutation"
    ? opener
    : undefined;
}

/** Whether a variable declaration sits at the top of a module, `const x = ...;`. */
function isTopLevelVariable(node: Node): boolean {
  const list = node.parent;
  return (
    isVariableDeclarationList(list) &&
    isVariableStatement(list.parent) &&
    isSourceFile(list.parent.parent)
  );
}

/** The top-level function a node declares, if it does: a declaration or a function-valued const. */
function functionNameOf(node: Node): string | undefined {
  if (isFunctionDeclaration(node) && isSourceFile(node.parent) && node.name) {
    return `function ${node.name.text}`;
  }
  if (!isVariableDeclaration(node) || !isTopLevelVariable(node)) {
    return undefined;
  }
  const { name, initializer } = node;
  const isFunctionConst =
    isIdentifier(name) &&
    initializer !== undefined &&
    (isArrowFunction(initializer) || isFunctionExpression(initializer));
  return isFunctionConst ? `function ${name.text}` : undefined;
}

/**
 * A router source cut into the pieces a proof has to live in: one chunk per
 * procedure body (the function handed to `.query(` / `.mutation(`) and one
 * per top-level function, since the loaders a procedure delegates to
 * receive the proof as a parameter and call the service themselves. What no
 * piece claims is the module preamble. A chunk never reaches into another,
 * and being read from the tree, it holds code only. Kept as a plain function
 * so block F can lift it when the rule widens to every router.
 */
function routeChunksOf(tree: SourceFile): Chunk[] {
  const roots: Array<{ name: string; line: number; node: Node }> = [
    { name: "module preamble", line: 1, node: tree },
  ];
  walk(tree, (node) => {
    const name = procedureNameOf(tree, node) ?? functionNameOf(node);
    if (name) roots.push({ name, line: chunkLine(tree, node), node });
    return true;
  });
  const isRoot = new Set(roots.map((root) => root.node));
  return roots.map(({ name, line, node }) => {
    const found = findNodes({
      root: node,
      matches: (candidate) =>
        reachesConvertedRead(candidate) || isProof(candidate),
      stop: (candidate) => isRoot.has(candidate),
    });
    return {
      name,
      line,
      reachesConvertedRead: found.some(reachesConvertedRead),
      carriesProof: found.some(isProof),
    };
  });
}

/** The line a chunk is reported on: its `.query(` opener, or its declaration. */
function chunkLine(tree: SourceFile, node: Node): number {
  const declaration = isVariableDeclaration(node) ? node.parent.parent : node;
  return lineOf(tree, procedureOpenerOf(node) ?? declaration);
}

/**
 * Every chunk of a router that reaches a converted read and carries no
 * proof, as `file:line chunk reads without a proof`, with the allow-listed
 * chunks left out. This is the function the fixture check drives.
 */
function routeReadsWithoutProofIn({
  file,
  tree,
  allowedChunks = [],
}: {
  file: string;
  tree: SourceFile;
  allowedChunks?: string[];
}): string[] {
  return routeChunksOf(tree)
    .filter((chunk) => chunk.reachesConvertedRead && !chunk.carriesProof)
    .filter((chunk) => !allowedChunks.includes(chunk.name))
    .map(
      (chunk) => `${file}:${chunk.line} ${chunk.name} reads without a proof`,
    );
}

/**
 * Every call into a proof-taking trace service whose own arguments carry no
 * proof, as `file:line service.method passes no proof`. A call reaches the
 * service as `traces.<service>.<method>(` or `evaluations.runs.<method>(`,
 * and names the proof in its own argument object: a call that hands the
 * service a project id, by name or by position, picks its tenant by hand and
 * is refused (ADR-144 blocks B and F). A comment naming the proof is not in
 * the tree, so it does not count.
 */
function serviceCallsWithoutProofIn({
  file,
  tree,
}: {
  file: string;
  tree: SourceFile;
}): string[] {
  const calls = findNodes({
    root: tree,
    matches: (node) =>
      isCallExpression(node) &&
      isPropertyAccessExpression(node.expression) &&
      isProofTakingService(node.expression.expression),
  });
  return calls.flatMap((call) => {
    if (!isCallExpression(call) || !isPropertyAccessExpression(call.expression))
      return [];
    const passesProof = call.arguments.some(
      (argument) => findNodes({ root: argument, matches: isProof }).length > 0,
    );
    const service = memberAccessOf(call.expression.expression);
    if (passesProof || !service) return [];
    const callee = `${service.label}.${call.expression.name.text}`;
    return [`${file}:${lineOf(tree, service.owner)} ${callee} passes no proof`];
  });
}

/** How many times each hand-tenant service is referenced in a source. */
function handTenantReferencesIn(tree: SourceFile): Record<string, number> {
  const counts: Record<string, number> = {};
  walk(tree, (node) => {
    const label = isIdentifier(node) ? node.text : memberAccessOf(node)?.label;
    const isHandTenant =
      label !== undefined &&
      ((isIdentifier(node) && HAND_TENANT_CLASSES.has(label)) ||
        (!isIdentifier(node) && HAND_TENANT_MEMBERS.has(label)));
    if (isHandTenant) counts[label] = (counts[label] ?? 0) + 1;
    return true;
  });
  return counts;
}

/** Every non-test route source under {@link ROUTE_ROOTS}, relative to `SRC`. */
function routeSources(): string[] {
  return ROUTE_ROOTS.flatMap((root) => sourceFilesUnder(path.join(SRC, root)))
    .filter((file) => !isTestFile(file))
    .map((file) => path.relative(SRC, path.join(APP, file)))
    .sort();
}

/**
 * Every source the gate reads, parsed once on first use: the converted
 * repositories and every route.
 */
let parsedSources: Map<string, SourceFile> | undefined;
function parsed(file: string): SourceFile {
  parsedSources ??= parseAll({
    files: [...new Set([...CONVERTED_REPOSITORIES, ...routeSources()])],
    readText: read,
  });
  const tree = parsedSources.get(file);
  if (!tree) throw new Error(`${file} was not parsed; add it to the scan`);
  return tree;
}

/**
 * Every route that calls, or hands over, a proof-taking service: a router
 * passing `traces.spans` to a helper reaches it as surely as one calling it.
 */
function routersReachingProofTakingServices(): string[] {
  return routeSources().filter(
    (file) =>
      findNodes({ root: parsed(file), matches: reachesConvertedRead }).length >
      0,
  );
}

/** Every route that imports a service taking a project id for trace reads. */
function routesImportingHandTenantServices(): string[] {
  return routeSources().filter((file) =>
    [...namedImportsOf(parsed(file))].some((name) =>
      HAND_TENANT_CLASSES.has(name),
    ),
  );
}

/** The value a binding or an assignment takes, and what it binds it to. */
function bindingOf(node: Node): { target: Node; value: Node } | undefined {
  const hasInitializer =
    isVariableDeclaration(node) ||
    isBindingElement(node) ||
    isParameterDeclaration(node);
  if (hasInitializer && node.initializer) {
    return { target: node.name, value: node.initializer };
  }
  if (
    isBinaryExpression(node) &&
    node.operatorToken.kind === SyntaxKind.EqualsToken
  ) {
    return { target: node.left, value: node.right };
  }
  return undefined;
}

/**
 * Whether a binding takes a trace or evaluations service apart,
 * `const { spans } = app.traces`, or holds one under another name,
 * `const list = getApp().traces.list`.
 */
function movesServiceOutOfSight(binding: {
  target: Node;
  value: Node;
}): boolean {
  const value = isAwaitExpression(binding.value)
    ? binding.value.expression
    : binding.value;
  const owner = lastNameOf(value);
  const takenApart =
    (isObjectBindingPattern(binding.target) ||
      isObjectLiteralExpression(binding.target)) &&
    owner !== undefined &&
    isIdentifier(owner) &&
    PROOF_TAKING_SERVICES.has(owner.text);
  const heldByName =
    isProofTakingService(value) ||
    memberAccessOf(value)?.label === "traces.logRecords";
  return takenApart || heldByName;
}

/**
 * Every line where a source takes a trace or evaluations service apart or
 * holds it under another name. Either moves the call out of reach of the
 * checks above, which read `traces.<service>.<method>(` at the call, so a
 * route may do neither.
 */
function servicesTakenApartIn({
  file,
  tree,
}: {
  file: string;
  tree: SourceFile;
}): string[] {
  const lines = findNodes({
    root: tree,
    matches: (node) => {
      const binding = bindingOf(node);
      return binding !== undefined && movesServiceOutOfSight(binding);
    },
  }).map((node) => lineOf(tree, bindingOf(node)?.value ?? node));
  const sourceLines = tree.text.split("\n");
  return [...new Set(lines)].map(
    (line) => `${file}:${line} ${sourceLines[line - 1]?.trim()}`,
  );
}

describe("store calls carry authorization", () => {
  describe("given the fence is the only tenant predicate", () => {
    /** @scenario "Trace repositories write no tenant of their own" */
    it("finds no hand-written tenant predicate in the converted repositories", () => {
      const offending = CONVERTED_REPOSITORIES.flatMap((file) => {
        const tree = parsed(file);
        // A converted repository carries the marker; a file that does not
        // is the wrong file, and "nothing offends" would be vacuous.
        expect(
          callsNamed(tree, "tenantScope"),
          `${file} carries no tenantScope marker`,
        ).toBeGreaterThan(0);
        return handWrittenTenantPredicatesIn({
          file,
          tree,
          skipMethods: notYetConvertedMethodsOf(file),
        });
      });

      expect(offending).toEqual([]);
    });

    /** @scenario "Trace repositories write no tenant of their own" */
    it("fails a repository that filters on the tenant column", () => {
      const tree = parseFixture([
        "export class FixtureRepository {",
        "  async findAll() {",
        "    return this.client.query({",
        "      query: `",
        "        SELECT TenantId AS TenantId, TraceId",
        "        FROM trace_summaries",
        "        WHERE TenantId = {tenantId:String}",
        "          AND (TenantId, TraceId) > ({cursorTenant:String}, {cursorTrace:String})",
        "      `,",
        "    });",
        "  }",
        "}",
      ]);

      expect(
        handWrittenTenantPredicatesIn({ file: "fixture.ts", tree }),
      ).toEqual(["fixture.ts:7 WHERE TenantId = {tenantId:String}"]);
    });
  });

  describe("given a repository could reach past the client", () => {
    it("reaches a tenant's own client only from a listed write method", () => {
      const reaches = CONVERTED_REPOSITORIES.flatMap((file) => {
        const tree = parsed(file);
        expect(
          methodsOf(tree).length,
          `${file} has no methods to scan`,
        ).toBeGreaterThan(0);
        return clientReachesIn({
          file,
          tree,
          allowedMethods: clientHoldersOf(file),
        });
      });

      expect(reaches).toEqual([]);
    });

    it.each([
      {
        evasion: "a read whose name starts with a write prefix",
        writeMethods: [],
        source: [
          "export class FixtureRepository {",
          "  async deleteStaleAndFind(tenantId: string) {",
          "    const client = await this.deps.resolveClient(tenantId);",
          '    return client.query({ query: "SELECT 1" });',
          "  }",
          "}",
        ],
        expected: [
          "fixture.ts:3 resolves a tenant's client in deleteStaleAndFind",
        ],
      },
      {
        evasion: "an arrow property placed right after a write method",
        writeMethods: ["upsertBatch"],
        source: [
          "export class FixtureRepository {",
          "  async upsertBatch(rows: Row[]) {",
          "    const client = await this.deps.resolveClient(rows[0].tenantId);",
          '    await client.insert({ table: "t", values: rows });',
          "  }",
          "  findStale = async (tenantId: string) => {",
          "    const client = await this.deps.resolveClient(tenantId);",
          '    return client.query({ query: "SELECT 1" });',
          "  };",
          "}",
        ],
        expected: ["fixture.ts:7 resolves a tenant's client in findStale"],
      },
      {
        evasion: "the resolver taken hold of and called under another name",
        writeMethods: [],
        source: [
          "export class FixtureRepository {",
          "  async findAll(tenantId: string) {",
          "    const resolve = this.deps.resolveClient;",
          "    const client = await resolve(tenantId);",
          '    return client.query({ query: "SELECT 1" });',
          "  }",
          "}",
        ],
        expected: ["fixture.ts:3 takes hold of the resolver in findAll"],
      },
      {
        evasion: "a client factory imported past the injected resolver",
        writeMethods: ["upsert"],
        source: [
          'import { getClickHouseClientForTenant } from "../../clients/clickhouse/client";',
          "",
          "export class FixtureRepository {",
          "  async upsert(row: Row) {",
          "    const client = await getClickHouseClientForTenant(row.tenantId);",
          '    await client.insert({ table: "t", values: [row] });',
          "  }",
          "}",
        ],
        expected: [
          "fixture.ts:1 reaches getClickHouseClientForTenant past the injected resolver",
          "fixture.ts:5 reaches getClickHouseClientForTenant past the injected resolver",
        ],
      },
      {
        evasion:
          "a resolver only stored by the constructor and typed by a field",
        writeMethods: ["upsert"],
        source: [
          "export class FixtureRepository {",
          "  private readonly resolveClient: ClickHouseClientResolver;",
          "  constructor({ resolveClient }: { resolveClient: ClickHouseClientResolver }) {",
          "    this.resolveClient = resolveClient;",
          "  }",
          "  async upsert(row: Row) {",
          "    const client = await this.resolveClient(row.tenantId);",
          '    await client.insert({ table: "t", values: [row] });',
          "  }",
          "}",
        ],
        expected: [],
      },
    ])("fails $evasion", ({ writeMethods, source, expected }) => {
      expect(
        clientReachesIn({
          file: "fixture.ts",
          tree: parseFixture(source),
          allowedMethods: writeMethods,
        }),
      ).toEqual(expected);
    });

    it("keeps the write list to methods that still resolve a client", () => {
      const stale = Object.entries(WRITE_METHODS).flatMap(([file, names]) => {
        const methods = methodsOf(parsed(file));
        return names.flatMap((name) => {
          const method = methods.find((candidate) => candidate.name === name);
          if (!method)
            return [`${file} has no method ${name}; remove it from the list`];
          return callsResolver(method.node)
            ? []
            : [`${file}#${name} resolves no client; remove it from the list`];
        });
      });

      expect(stale).toEqual([]);
    });

    it("keeps the not-yet-converted list to methods that still read by tenant id", () => {
      const stale = NOT_YET_CONVERTED.flatMap(({ file, method: name }) => {
        const tree = parsed(file);
        const method = methodsOf(tree).find(
          (candidate) => candidate.name === name,
        );
        if (!method)
          return [`${file} has no method ${name}; remove it from the list`];
        const stillByTenantId =
          callsResolver(method.node) &&
          handWrittenTenantPredicatesIn({ file, tree, root: method.node })
            .length > 0;
        return stillByTenantId
          ? []
          : [
              `${file}#${name} reads through the proof now; remove it from the list`,
            ];
      });

      expect(stale).toEqual([]);
    });
  });

  describe("given the fragment expander bypasses the whole-statement check", () => {
    it("is imported by its one production caller and the test helper only", () => {
      const readFromApp = (file: string) =>
        readFileSync(path.join(APP, file), "utf8");
      // Only a file whose text names the expander can import it, so only
      // those are parsed.
      const candidates = [
        ...sourceFilesUnder(path.join(APP, "src")),
        ...sourceFilesUnder(path.join(APP, "ee")),
      ]
        .filter((file) => !isTestFile(file))
        .filter((file) => readFromApp(file).includes("expandFragment"));
      const trees = parseAll({ files: candidates, readText: readFromApp });
      const importers = candidates
        .filter((file) =>
          namedImportsOf(trees.get(file) as SourceFile).has("expandFragment"),
        )
        .sort();

      // The named caller must be found, or the scan is reading the wrong tree.
      expect(importers).toContain(
        "src/app/api/traces/[[...route]]/trace-filter.ts",
      );
      expect(
        importers.filter((file) => !FRAGMENT_EXPANDER_CALLERS.has(file)),
      ).toEqual([]);
    });
  });

  describe("given a trace route reaches a converted read", () => {
    it("carries a proof in the same procedure body or loader", () => {
      const missing = TRACE_ROUTERS.flatMap((file) => {
        const tree = parsed(file);
        expect(
          routeChunksOf(tree).filter((chunk) => chunk.reachesConvertedRead)
            .length,
          `${file} reaches no converted read; the router list is stale`,
        ).toBeGreaterThan(0);
        return routeReadsWithoutProofIn({
          file,
          tree,
          allowedChunks: ROUTE_CHUNKS_WITHOUT_PROOF.filter(
            (allowed) => allowed.file === file,
          ).map((allowed) => allowed.chunk),
        });
      });

      expect(missing).toEqual([]);
    });

    it.each([
      {
        shape: "a comment that only mentions the proof",
        source: [
          "export const fixtureRouter = createTRPCRouter({",
          "  list: protectedProcedure",
          "    .input(z.object({ projectId: z.string() }))",
          "    .query(async ({ input }) => {",
          "      // authorization is checked by the caller",
          "      return getApp().traces.list.findAll(input);",
          "    }),",
          "});",
        ],
        expected: ["fixture.ts:4 procedure list reads without a proof"],
      },
      {
        shape: "a proof minted in the procedure body",
        source: [
          "export const fixtureRouter = createTRPCRouter({",
          "  list: protectedProcedure",
          "    .input(z.object({ projectId: z.string() }))",
          "    .query(async ({ ctx, input }) => {",
          "      const authorization = requireRouteAuthorization(ctx);",
          "      return getApp().traces.list.findAll({ authorization, ...input });",
          "    }),",
          "});",
        ],
        expected: [],
      },
    ])("reads the code, not the comments, for $shape", ({
      source,
      expected,
    }) => {
      expect(
        routeReadsWithoutProofIn({
          file: "fixture.ts",
          tree: parseFixture(source),
        }),
      ).toEqual(expected);
    });

    it("keeps the no-proof list to chunks that still read without one", () => {
      const stale = ROUTE_CHUNKS_WITHOUT_PROOF.flatMap(
        ({ file, chunk: name }) => {
          const chunk = routeChunksOf(parsed(file)).find(
            (candidate) => candidate.name === name,
          );
          if (!chunk)
            return [`${file} has no ${name}; remove it from the list`];
          const stillWithoutProof =
            chunk.reachesConvertedRead && !chunk.carriesProof;
          return stillWithoutProof
            ? []
            : [`${file} ${name} carries a proof now; remove it from the list`];
        },
      );

      expect(stale).toEqual([]);
    });
  });

  describe("given a trace route calls a trace service", () => {
    /** @scenario "A trace route without a proof fails the build" */
    it("hands every proof-taking service the proof by name", () => {
      const missing = TRACE_ROUTERS.flatMap((file) =>
        serviceCallsWithoutProofIn({ file, tree: parsed(file) }),
      );

      expect(missing).toEqual([]);
    });

    it("lists every router that reaches a proof-taking service", () => {
      // A new router reaching a trace service joins the list, or the checks
      // above never read it.
      expect(routersReachingProofTakingServices()).toEqual(
        [...TRACE_ROUTERS].sort(),
      );
    });

    it.each([
      {
        shape: "a project id passed by position",
        source: [
          "export const fixtureRouter = createTRPCRouter({",
          "  spans: protectedProcedure",
          "    .query(async ({ ctx, input }) => {",
          "      const authorization = requireRouteAuthorization(ctx);",
          "      return getApp().traces.spans.getSpansByTraceId(input.projectId, input.traceId);",
          "    }),",
          "});",
        ],
        expected: [
          "fixture.ts:5 traces.spans.getSpansByTraceId passes no proof",
        ],
      },
      {
        shape: "a project id passed by name, with a comment naming the proof",
        source: [
          "export const fixtureRouter = createTRPCRouter({",
          "  evals: protectedProcedure",
          "    .query(async ({ input }) => {",
          "      return getApp().evaluations.runs.findByTraceId({",
          "        // authorization is the caller's job",
          "        tenantId: input.projectId,",
          "        traceId: input.traceId,",
          "      });",
          "    }),",
          "});",
        ],
        expected: [
          "fixture.ts:4 evaluations.runs.findByTraceId passes no proof",
        ],
      },
      {
        shape: "the proof passed by name",
        source: [
          "export const fixtureRouter = createTRPCRouter({",
          "  evals: protectedProcedure",
          "    .query(async ({ ctx, input }) => {",
          "      return getApp().evaluations.runs.findByTraceId({",
          "        authorization: requireRouteAuthorization(ctx),",
          "        traceId: input.traceId,",
          "      });",
          "    }),",
          "});",
        ],
        expected: [],
      },
    ])("refuses $shape unless the call carries the proof", ({
      source,
      expected,
    }) => {
      expect(
        serviceCallsWithoutProofIn({
          file: "fixture.ts",
          tree: parseFixture(source),
        }),
      ).toEqual(expected);
    });

    it("keeps the hand-tenant reads to the baseline, and the baseline to what is still there", () => {
      const byFileAndService = (
        a: { file: string; service: string },
        b: { file: string; service: string },
      ) => a.file.localeCompare(b.file) || a.service.localeCompare(b.service);
      const counted = routeSources()
        .flatMap((file) =>
          Object.entries(handTenantReferencesIn(parsed(file))).map(
            ([service, references]) => ({ file, service, references }),
          ),
        )
        .sort(byFileAndService);

      expect(counted).toEqual(
        HAND_TENANT_READS.map(({ file, service, references }) => ({
          file,
          service,
          references,
        })).sort(byFileAndService),
      );
    });

    it("lists every route that imports a service taking a project id", () => {
      // The baseline above counts what a route holds; this keeps a new route
      // importing one of those services from going uncounted.
      const listed = new Set(
        HAND_TENANT_READS.filter(({ service }) => /Service$/.test(service)).map(
          ({ file }) => file,
        ),
      );

      expect(routesImportingHandTenantServices()).toEqual([...listed].sort());
    });
  });

  describe("given a route could move a trace service out of the checks' sight", () => {
    it("takes no trace service apart and holds none under another name", () => {
      const found = routeSources().flatMap((file) =>
        servicesTakenApartIn({ file, tree: parsed(file) }),
      );

      expect(found).toEqual([]);
    });

    it.each([
      {
        shape: "a service destructured out of the app",
        source: [
          "const { spans } = app.traces;",
          "return spans.getSpansByTraceId(input.projectId, input.traceId);",
        ],
        expected: ["fixture.ts:1 const { spans } = app.traces;"],
      },
      {
        shape: "a service destructured out of an awaited call",
        source: [
          "const { runs } = getApp().evaluations",
          "return runs.findByTraceId({ tenantId: input.projectId });",
        ],
        expected: ["fixture.ts:1 const { runs } = getApp().evaluations"],
      },
      {
        shape: "a service held under another name",
        source: [
          "const list = getApp().traces.list;",
          "return list.getList({ tenantId: input.projectId });",
        ],
        expected: ["fixture.ts:1 const list = getApp().traces.list;"],
      },
      {
        shape: "a service called where it is reached",
        source: [
          "return getApp().traces.list.getList({ authorization, timeRange });",
        ],
        expected: [],
      },
    ])("reports $shape", ({ source, expected }) => {
      expect(
        servicesTakenApartIn({
          file: "fixture.ts",
          tree: parseFixture(source),
        }),
      ).toEqual(expected);
    });
  });
});
