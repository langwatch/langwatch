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
import { describe, expect, it } from "vitest";
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
 * A call into, or a hand-over of, a service whose repository reads through
 * the proof: the trace list, summary, spans and session groups services, and
 * the evaluation runs service that owns the evaluation summaries. Narrowing
 * the detail proof reaches the summary service too, so a router that only
 * calls `traceDetailAuthorization` reaches a converted read as surely.
 */
const CONVERTED_SERVICE_READ =
  /\b(?:traces\.(?:list|summary|spans|sessionGroups)|evaluations\.runs|traceDetailAuthorization)\b/;

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
 * The proof-taking trace services and the evaluation runs service, reached
 * as `traces.<service>.<method>(` or `evaluations.runs.<method>(`. Every such
 * call in a trace router names the proof in its own argument object: a call
 * that hands the service a project id, by name or by position, picks its
 * tenant by hand and is refused (ADR-144 blocks B and F).
 */
const PROOF_TAKING_CALL =
  /\b(?:traces\.(?:list|summary|spans|sessionGroups)|evaluations\.runs)\.(\w+)\s*\(/g;

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
const HAND_TENANT_SERVICE =
  /\b(traces\.logRecords|codingAgents\.sessions|TraceService|EvaluationService|ClickHouseTraceService)\b/g;

/** An import of a service that takes a project id for every trace read. */
const IMPORTS_HAND_TENANT_SERVICE =
  /import\s*(?:type\s*)?\{[^}]*\b(?:TraceService|EvaluationService|ClickHouseTraceService)\b[^}]*\}\s*from/;

/**
 * A trace or evaluations service taken apart or held under another name:
 * `const { spans } = app.traces` or `const list = getApp().traces.list`.
 * Either moves the call out of reach of the checks above, which read
 * `traces.<service>.<method>(` at the call, so a route may do neither.
 */
const SERVICE_TAKEN_APART =
  /\}\s*=\s*(?:await\s+)?[\w$.()]*\b(?:traces|evaluations)\s*(?:;|\n|$)/;
const SERVICE_HELD_BY_NAME =
  /=\s*(?:await\s+)?[\w$.()]*\b(?:traces\.(?:list|summary|spans|sessionGroups|logRecords)|evaluations\.runs)\s*(?:;|\n|$)/;

function read(relativeToSrc: string): string {
  return readFileSync(path.join(SRC, relativeToSrc), "utf8");
}

function lineAt(source: string, offset: number): number {
  return source.slice(0, offset).split("\n").length;
}

/**
 * The source with every line and block comment blanked to spaces, newlines
 * kept, so offsets and line numbers still point into the original. String
 * literals are stepped over whole: a `//` inside a URL is not a comment.
 */
function withoutComments(source: string): string {
  let out = "";
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];
    if (ch === "/" && next === "/") {
      const end = source.indexOf("\n", i);
      const stop = end === -1 ? source.length : end;
      out += " ".repeat(stop - i);
      i = stop;
    } else if (ch === "/" && next === "*") {
      const end = source.indexOf("*/", i + 2);
      const stop = end === -1 ? source.length : end + 2;
      out += source.slice(i, stop).replace(/[^\n]/g, " ");
      i = stop;
    } else if (ch === '"' || ch === "'") {
      const end = quotedEnd(source, i);
      out += source.slice(i, end + 1);
      i = end + 1;
    } else if (ch === "`") {
      const end = templateEnd(source, i);
      out += source.slice(i, end + 1);
      i = end + 1;
    } else {
      out += ch;
      i += 1;
    }
  }
  return out;
}

/**
 * Every string literal in a TypeScript source, with the offset of its first
 * character. A template literal is returned whole, `${}` expressions
 * included, so a nested template never splits the SQL around it. Comments
 * are skipped so a commented-out predicate does not count as query text.
 */
function stringLiteralsIn(
  source: string,
): Array<{ text: string; offset: number }> {
  const found: Array<{ text: string; offset: number }> = [];
  let i = 0;
  while (i < source.length) {
    const ch = source[i];
    const next = source[i + 1];
    if (ch === "/" && next === "/") {
      const end = source.indexOf("\n", i);
      i = end === -1 ? source.length : end;
    } else if (ch === "/" && next === "*") {
      const end = source.indexOf("*/", i + 2);
      i = end === -1 ? source.length : end + 2;
    } else if (ch === '"' || ch === "'") {
      const end = quotedEnd(source, i);
      found.push({ text: source.slice(i + 1, end), offset: i + 1 });
      i = end + 1;
    } else if (ch === "`") {
      const end = templateEnd(source, i);
      found.push({ text: source.slice(i + 1, end), offset: i + 1 });
      i = end + 1;
    } else {
      i += 1;
    }
  }
  return found;
}

/** Offset of the closing quote of the literal opened at `start`. */
function quotedEnd(source: string, start: number): number {
  const quote = source[start];
  let i = start + 1;
  while (i < source.length) {
    if (source[i] === "\\") i += 2;
    else if (source[i] === quote || source[i] === "\n") return i;
    else i += 1;
  }
  return source.length;
}

/** Offset of the closing backtick of the template opened at `start`. */
function templateEnd(source: string, start: number): number {
  let i = start + 1;
  while (i < source.length) {
    const ch = source[i];
    if (ch === "\\") i += 2;
    else if (ch === "`") return i;
    else if (ch === "$" && source[i + 1] === "{")
      i = expressionEnd(source, i + 1) + 1;
    else i += 1;
  }
  return source.length;
}

/** Offset of the `}` closing the `${` expression whose `{` is at `start`. */
function expressionEnd(source: string, start: number): number {
  let depth = 0;
  let i = start;
  while (i < source.length) {
    const ch = source[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return i;
    } else if (ch === "`") i = templateEnd(source, i);
    else if (ch === '"' || ch === "'") i = quotedEnd(source, i);
    i += 1;
  }
  return source.length;
}

type Method = { name: string; start: number; end: number };

/**
 * The methods of the first class in a source, each spanning from its
 * declaration line to the next one. A method head is a two-space-indented
 * `name(` declaration or a `name = (` / `name = async (` arrow property; SQL
 * inside a method sits deeper, so a query line never opens a method. If one
 * ever did, it would split a method in two under a bogus name, and a client
 * reached in the second half would fail the gate as a read, not pass it: the
 * fragility is on the closed side.
 */
function methodsOf(source: string): Method[] {
  const classAt = source.search(/^(?:export\s+)?class\s/m);
  if (classAt === -1) return [];
  const declaration =
    /^ {2}(?:(?:public|private|protected|static|readonly|async|get)\s+)*([A-Za-z_$][\w$]*)\s*(?:<[^>\n]*>)?\s*(?:\(|=\s*(?:async\s*)?(?:<[^>\n]*>\s*)?\()/gm;
  const heads = [...source.slice(classAt).matchAll(declaration)].map(
    (match) => ({
      name: match[1] as string,
      start: classAt + (match.index as number),
    }),
  );
  return heads.map((head, index) => ({
    ...head,
    end: heads[index + 1]?.start ?? source.length,
  }));
}

function methodAt(methods: Method[], offset: number): Method | undefined {
  return methods.find(
    (method) => offset >= method.start && offset < method.end,
  );
}

/**
 * Every query-text line of a repository that names the tenant in a predicate
 * of its own, as `file:line text`, with the not-yet-converted methods left
 * out. This is the function the fixture check drives, so the two agree.
 */
function handWrittenTenantPredicatesIn({
  file,
  source,
  skipMethods = [],
}: {
  file: string;
  source: string;
  skipMethods?: string[];
}): string[] {
  const methods = methodsOf(source);
  const offending: string[] = [];
  for (const literal of stringLiteralsIn(source)) {
    const method = methodAt(methods, literal.offset);
    if (method && skipMethods.includes(method.name)) continue;
    literal.text.split("\n").forEach((line, index) => {
      if (!HAND_WRITTEN_TENANT_PREDICATE.test(line)) return;
      const number = lineAt(source, literal.offset) + index;
      offending.push(`${file}:${number} ${line.trim()}`);
    });
  }
  return offending;
}

/** The injected resolver, and the client factories it stands in front of. */
const CLIENT_RESOLVER = /\b(?:resolveClient|getClickHouseClientFor\w+)\b/g;

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
  source,
  allowedMethods,
}: {
  file: string;
  source: string;
  allowedMethods: string[];
}): string[] {
  const code = withoutComments(source);
  const methods = methodsOf(code);
  const reaches: string[] = [];
  for (const match of code.matchAll(CLIENT_RESOLVER)) {
    const offset = match.index as number;
    const name = match[0];
    const line = lineAt(code, offset);
    if (name !== "resolveClient") {
      reaches.push(
        `${file}:${line} reaches ${name} past the injected resolver`,
      );
      continue;
    }
    const method = methodAt(methods, offset);
    const where = method?.name ?? "<outside any method>";
    if (allowedMethods.includes(where)) continue;
    const isCall = /^\s*\(/.test(code.slice(offset + name.length));
    if (isCall) {
      reaches.push(`${file}:${line} resolves a tenant's client in ${where}`);
      continue;
    }
    if (method?.name === "constructor") continue;
    const declaresField =
      /(?:readonly|private|protected|public)\s+$/.test(code.slice(0, offset)) &&
      /^\s*\??:/.test(code.slice(offset + name.length));
    if (declaresField) continue;
    reaches.push(`${file}:${line} takes hold of the resolver in ${where}`);
  }
  return reaches;
}

/** Every `.ts`/`.tsx` under `dir`, as paths relative to `APP`. */
function sourceFilesUnder(dir: string): string[] {
  const files: string[] = [];
  const walk = (current: string) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name.startsWith(".")) continue;
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry.name)) files.push(path.relative(APP, full));
    }
  };
  walk(dir);
  return files;
}

function isTestFile(file: string): boolean {
  return /\.test\.tsx?$/.test(file) || file.includes("/__tests__/");
}

const IMPORTS_FRAGMENT_EXPANDER =
  /import\s*\{[^}]*\bexpandFragment\b[^}]*\}\s*from/;

type Chunk = { name: string; line: number; text: string };

/**
 * A router source cut into the pieces a proof has to live in: one chunk per
 * procedure body (from its `.query(` / `.mutation(` opener to the next) and
 * one per top-level function, since the loaders a procedure delegates to
 * receive the proof as a parameter and call the service themselves. The
 * source is read without its comments, so a chunk's text is code only. Kept
 * as a plain function so block F can lift it when the rule widens to every
 * router.
 */
function routeChunksOf(source: string): Chunk[] {
  const code = withoutComments(source);
  const openers = [
    ...code.matchAll(/\.(?:query|mutation)\(\s*(?:async\s*)?\(/g),
  ].map((match) => ({
    offset: match.index as number,
    name: procedureNameBefore(code, match.index as number),
  }));
  const functions = [
    ...code.matchAll(
      /^(?:export\s+)?(?:async\s+)?function\s+([A-Za-z_$][\w$]*)/gm,
    ),
  ].map((match) => ({
    offset: match.index as number,
    name: `function ${match[1]}`,
  }));
  const boundaries = [
    { offset: 0, name: "module preamble" },
    ...openers,
    ...functions,
  ].sort((a, b) => a.offset - b.offset);
  return boundaries.map((boundary, index) => ({
    name: boundary.name,
    line: lineAt(code, boundary.offset),
    text: code.slice(
      boundary.offset,
      boundaries[index + 1]?.offset ?? code.length,
    ),
  }));
}

/** The `name: xProcedure` key the opener at `offset` belongs to. */
function procedureNameBefore(source: string, offset: number): string {
  const keys = [
    ...source
      .slice(0, offset)
      .matchAll(/^\s+([A-Za-z_$][\w$]*):\s*\w*[pP]rocedure\b/gm),
  ];
  const last = keys[keys.length - 1];
  return last
    ? `procedure ${last[1]}`
    : `procedure at ${lineAt(source, offset)}`;
}

const PROOF = /\bauthorization\b/;

/**
 * Every chunk of a router that reaches a converted read and carries no
 * proof, as `file:line chunk reads without a proof`, with the allow-listed
 * chunks left out. This is the function the fixture check drives.
 */
function routeReadsWithoutProofIn({
  file,
  source,
  allowedChunks = [],
}: {
  file: string;
  source: string;
  allowedChunks?: string[];
}): string[] {
  return routeChunksOf(source)
    .filter((chunk) => CONVERTED_SERVICE_READ.test(chunk.text))
    .filter((chunk) => !PROOF.test(chunk.text))
    .filter((chunk) => !allowedChunks.includes(chunk.name))
    .map(
      (chunk) => `${file}:${chunk.line} ${chunk.name} reads without a proof`,
    );
}

/** Offset of the `)` closing the call whose `(` is at `open`. */
function callEnd(code: string, open: number): number {
  let depth = 0;
  let i = open;
  while (i < code.length) {
    const ch = code[i];
    if (ch === "(" || ch === "{" || ch === "[") depth += 1;
    else if (ch === ")" || ch === "}" || ch === "]") {
      depth -= 1;
      if (depth === 0) return i;
    } else if (ch === '"' || ch === "'") i = quotedEnd(code, i);
    else if (ch === "`") i = templateEnd(code, i);
    i += 1;
  }
  return code.length;
}

/**
 * Every call into a proof-taking trace service whose own arguments carry no
 * proof, as `file:line service.method passes no proof`. The arguments are
 * read without comments, so a comment naming the proof does not count, and
 * a positional project id has nowhere to hide.
 */
function serviceCallsWithoutProofIn({
  file,
  source,
}: {
  file: string;
  source: string;
}): string[] {
  const code = withoutComments(source);
  const missing: string[] = [];
  for (const match of code.matchAll(PROOF_TAKING_CALL)) {
    const start = match.index as number;
    const open = start + match[0].length - 1;
    const args = code.slice(open + 1, callEnd(code, open));
    if (PROOF.test(args)) continue;
    const callee = match[0].replace(/\s*\($/, "");
    missing.push(`${file}:${lineAt(code, start)} ${callee} passes no proof`);
  }
  return missing;
}

/** How many times each hand-tenant service is referenced in a source. */
function handTenantReferencesIn(source: string): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const match of withoutComments(source).matchAll(HAND_TENANT_SERVICE)) {
    const service = match[1] as string;
    counts[service] = (counts[service] ?? 0) + 1;
  }
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
 * Every route that calls, or hands over, a proof-taking service: a router
 * passing `traces.spans` to a helper reaches it as surely as one calling it.
 */
function routersReachingProofTakingServices(): string[] {
  return routeSources().filter((file) =>
    CONVERTED_SERVICE_READ.test(withoutComments(read(file))),
  );
}

/** Every route that imports a service taking a project id for trace reads. */
function routesImportingHandTenantServices(): string[] {
  return routeSources().filter((file) =>
    IMPORTS_HAND_TENANT_SERVICE.test(read(file)),
  );
}

/** Every place a source takes a trace service apart or holds it by name. */
function servicesTakenApartIn({
  file,
  source,
}: {
  file: string;
  source: string;
}): string[] {
  const code = withoutComments(source);
  return code.split("\n").flatMap((line, index) => {
    // Each line with the next, so a binding split before its `;` is read
    // whole.
    const text = `${line}\n`;
    return SERVICE_TAKEN_APART.test(text) || SERVICE_HELD_BY_NAME.test(text)
      ? [`${file}:${index + 1} ${line.trim()}`]
      : [];
  });
}

describe("store calls carry authorization", () => {
  describe("given the fence is the only tenant predicate", () => {
    /** @scenario "Trace repositories write no tenant of their own" */
    it("finds no hand-written tenant predicate in the converted repositories", () => {
      const offending = CONVERTED_REPOSITORIES.flatMap((file) => {
        const source = read(file);
        // A converted repository carries the marker; a file that does not
        // is the wrong file, and "nothing offends" would be vacuous.
        expect(source, `${file} carries no tenantScope marker`).toMatch(
          /\btenantScope\(/,
        );
        return handWrittenTenantPredicatesIn({
          file,
          source,
          skipMethods: notYetConvertedMethodsOf(file),
        });
      });

      expect(offending).toEqual([]);
    });

    /** @scenario "Trace repositories write no tenant of their own" */
    it("fails a repository that filters on the tenant column", () => {
      const source = [
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
      ].join("\n");

      expect(
        handWrittenTenantPredicatesIn({ file: "fixture.ts", source }),
      ).toEqual(["fixture.ts:7 WHERE TenantId = {tenantId:String}"]);
    });
  });

  describe("given a repository could reach past the client", () => {
    it("reaches a tenant's own client only from a listed write method", () => {
      const reaches = CONVERTED_REPOSITORIES.flatMap((file) => {
        const source = read(file);
        expect(
          methodsOf(source).length,
          `${file} has no methods to scan`,
        ).toBeGreaterThan(0);
        return clientReachesIn({
          file,
          source,
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
          source: source.join("\n"),
          allowedMethods: writeMethods,
        }),
      ).toEqual(expected);
    });

    it("keeps the write list to methods that still resolve a client", () => {
      const stale = Object.entries(WRITE_METHODS).flatMap(([file, names]) => {
        const source = withoutComments(read(file));
        const methods = methodsOf(source);
        return names.flatMap((name) => {
          const method = methods.find((candidate) => candidate.name === name);
          if (!method)
            return [`${file} has no method ${name}; remove it from the list`];
          const body = source.slice(method.start, method.end);
          return /\bresolveClient\s*\(/.test(body)
            ? []
            : [`${file}#${name} resolves no client; remove it from the list`];
        });
      });

      expect(stale).toEqual([]);
    });

    it("keeps the not-yet-converted list to methods that still read by tenant id", () => {
      const stale = NOT_YET_CONVERTED.flatMap(({ file, method: name }) => {
        const source = read(file);
        const method = methodsOf(source).find(
          (candidate) => candidate.name === name,
        );
        if (!method)
          return [`${file} has no method ${name}; remove it from the list`];
        const body = source.slice(method.start, method.end);
        const stillByTenantId =
          /\bresolveClient\s*\(/.test(withoutComments(body)) &&
          handWrittenTenantPredicatesIn({ file, source: body }).length > 0;
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
      const importers = [
        ...sourceFilesUnder(path.join(APP, "src")),
        ...sourceFilesUnder(path.join(APP, "ee")),
      ]
        .filter((file) => !isTestFile(file))
        .filter((file) =>
          IMPORTS_FRAGMENT_EXPANDER.test(
            readFileSync(path.join(APP, file), "utf8"),
          ),
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
        const source = read(file);
        expect(
          routeChunksOf(source).filter((chunk) =>
            CONVERTED_SERVICE_READ.test(chunk.text),
          ).length,
          `${file} reaches no converted read; the router list is stale`,
        ).toBeGreaterThan(0);
        return routeReadsWithoutProofIn({
          file,
          source,
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
          source: source.join("\n"),
        }),
      ).toEqual(expected);
    });

    it("keeps the no-proof list to chunks that still read without one", () => {
      const stale = ROUTE_CHUNKS_WITHOUT_PROOF.flatMap(
        ({ file, chunk: name }) => {
          const chunk = routeChunksOf(read(file)).find(
            (candidate) => candidate.name === name,
          );
          if (!chunk)
            return [`${file} has no ${name}; remove it from the list`];
          const stillWithoutProof =
            CONVERTED_SERVICE_READ.test(chunk.text) && !PROOF.test(chunk.text);
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
        serviceCallsWithoutProofIn({ file, source: read(file) }),
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
          source: source.join("\n"),
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
          Object.entries(handTenantReferencesIn(read(file))).map(
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
        servicesTakenApartIn({ file, source: read(file) }),
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
        servicesTakenApartIn({ file: "fixture.ts", source: source.join("\n") }),
      ).toEqual(expected);
    });
  });
});
