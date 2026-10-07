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
}> = [];

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

/** The routers whose reads reach a converted repository. */
const TRACE_ROUTERS = [
  "server/api/routers/tracesV2.ts",
  "server/api/routers/sharedTrace.ts",
  "server/api/routers/llmModelCosts.ts",
  "server/api/routers/traceEditOverlay.ts",
];

/**
 * A call into, or a hand-over of, a service whose repository reads through
 * the proof: the trace list, summary, spans and session groups services, and
 * the evaluation runs service that owns the evaluation summaries.
 */
const CONVERTED_SERVICE_READ =
  /\b(?:traces\.(?:list|summary|spans|sessionGroups)|evaluations\.runs)\b/;

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
});
