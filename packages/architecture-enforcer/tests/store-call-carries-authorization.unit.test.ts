/**
 * ADR-175: a converted read writes a `tenantScope` marker; the reader expands it into the only
 * tenant predicate. A method that resolves the tenant's own client and names `TenantId` itself
 * never meets the reader, so an aggregate silently reads less. This gate makes that unwriteable.
 */
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

import ts from "typescript";
import { describe, expect, it } from "vitest";

const WORKSPACE = path.resolve(import.meta.dirname, "../../..");
const REPOSITORIES = path.join(WORKSPACE, "modules/trace/process/src/repositories/clickhouse");
const READER = "packages/clickhouse-client/src/authorized-reads.ts";

/** The repositories block C converted to read through the proof-checking client. */
const CONVERTED_REPOSITORIES = [
  "trace-list.repository.ts",
  "trace-summary.repository.ts",
  "span-storage.repository.ts",
  "session-groups.repository.ts",
  "trace-evaluation-runs.repository.ts",
];

/**
 * The write methods of each converted repository: the only places that may resolve a tenant's
 * own client, because a write carries no proof. Listed by name, not by prefix; a listed method
 * that disappears or stops resolving a client fails the gate, so the list stays true.
 */
const WRITE_METHODS: Record<string, string[]> = {
  "trace-summary.repository.ts": ["upsert", "upsertBatch"],
  "span-storage.repository.ts": ["insertSpan", "insertSpans"],
};

/**
 * Methods of a converted repository that still read by tenant id, named `Class.method`, each with
 * why and who converts it. A stale entry fails the gate, so the list can only shrink.
 */
const NOT_YET_CONVERTED: { file: string; method: string; reason: string }[] = [
  {
    file: "trace-summary.repository.ts",
    method: "TraceSummaryProjectionClickHouseRepository.findByTraceId",
    reason:
      "the summary fold's read-back of its own row inside the projection store; block F moves it",
  },
];

/**
 * The only sources allowed to expand a WHERE fragment outside a whole statement: the legacy
 * search read, which assembles its own statement, and the package that defines the expander.
 */
const FRAGMENT_EXPANDER_CALLERS = new Set([
  "modules/trace/process/src/repositories/clickhouse/clickhouse.trace-member-client.repository.ts",
  "packages/clickhouse-client/src/authorized-reads.ts",
  "packages/clickhouse-client/src/index.ts",
]);

type Method = { owner: string; name: string; node: ts.Node; start: number; end: number };

/** Whether a list names the method, bare (`upsert`) or with its class (`Class.findByTraceId`). */
function isListed(method: Method, names: readonly string[]): boolean {
  return names.includes(method.name) || names.includes(`${method.owner}.${method.name}`);
}

function parse({ fileName, text }: { fileName: string; text: string }): ts.SourceFile {
  return ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true);
}

function parsed(file: string): ts.SourceFile {
  return parse({ fileName: file, text: readFileSync(path.join(REPOSITORIES, file), "utf8") });
}

function parseFixture(lines: readonly string[]): ts.SourceFile {
  return parse({ fileName: "fixture.ts", text: lines.join("\n") });
}

/**
 * The reader's own pattern for a hand-written tenant predicate, read from its source so the gate
 * and the run-time refusal cannot drift. This package depends on no runtime package, so the
 * pattern is taken from the declaration rather than imported.
 */
function readerPattern(): RegExp {
  const tree = parse({
    fileName: READER,
    text: readFileSync(path.join(WORKSPACE, READER), "utf8"),
  });
  let pattern: RegExp | undefined;
  walk(tree, (node) => {
    if (!ts.isVariableDeclaration(node) || !ts.isIdentifier(node.name)) return true;
    if (node.name.text !== "HAND_WRITTEN_TENANT_PREDICATE") return true;
    const initializer = node.initializer;
    if (!initializer || !ts.isRegularExpressionLiteral(initializer)) return true;
    const literal = initializer.getText(tree);
    const flagsAt = literal.lastIndexOf("/");
    pattern = new RegExp(literal.slice(1, flagsAt), literal.slice(flagsAt + 1));
    return false;
  });
  if (!pattern) throw new Error(`${READER} declares no HAND_WRITTEN_TENANT_PREDICATE literal`);
  return pattern;
}

const HAND_WRITTEN_TENANT_PREDICATE = readerPattern();

/** Calls `visit` on `root` and below, in source order; a node answered false is not entered. */
function walk(root: ts.Node, visit: (node: ts.Node) => boolean): void {
  if (!visit(root)) return;
  root.forEachChild((child) => walk(child, visit));
}

function lineOf(tree: ts.SourceFile, offset: number): number {
  return tree.getLineAndCharacterOfPosition(offset).line + 1;
}

/** The name a class member is called by, if it is a method (an arrow property is one). */
function methodNameOf(member: ts.ClassElement): string | undefined {
  if (ts.isConstructorDeclaration(member)) return "constructor";
  const isFunctionProperty =
    ts.isPropertyDeclaration(member) &&
    member.initializer !== void 0 &&
    (ts.isArrowFunction(member.initializer) || ts.isFunctionExpression(member.initializer));
  const isMethod =
    ts.isMethodDeclaration(member) ||
    ts.isGetAccessorDeclaration(member) ||
    ts.isSetAccessorDeclaration(member) ||
    isFunctionProperty;
  if (!isMethod || !member.name) return void 0;
  const name = member.name;
  const isPlainName = ts.isIdentifier(name) || ts.isPrivateIdentifier(name);
  if (isPlainName) return name.text;
  return ts.isStringLiteral(name) ? name.text : void 0;
}

function methodsOf(tree: ts.SourceFile): Method[] {
  const methods: Method[] = [];
  walk(tree, (node) => {
    if (!ts.isClassLike(node)) return true;
    const owner = node.name?.text ?? "<anonymous>";
    for (const member of node.members) {
      const name = methodNameOf(member);
      if (name === void 0) continue;
      methods.push({ owner, name, node: member, start: member.getStart(tree), end: member.end });
    }
    return true;
  });
  return methods;
}

/** The innermost method spanning `offset`. */
function methodAt(methods: Method[], offset: number): Method | undefined {
  return methods.filter((method) => offset >= method.start && offset < method.end).at(-1);
}

/** Every string or template literal under `root`, read raw, with its first character's offset. */
function literalsIn({ tree, root }: { tree: ts.SourceFile; root: ts.Node }) {
  const found: { text: string; offset: number }[] = [];
  walk(root, (node) => {
    const isLiteral =
      ts.isStringLiteral(node) ||
      ts.isNoSubstitutionTemplateLiteral(node) ||
      ts.isTemplateExpression(node);
    if (!isLiteral) return true;
    const offset = node.getStart(tree) + 1;
    found.push({ text: tree.text.slice(offset, node.end - 1), offset });
    return false;
  });
  return found;
}

/** Every query-text line that names the tenant in a predicate of its own, as `file:line text`. */
function handWrittenTenantPredicatesIn({
  file,
  tree,
  root = tree,
  skipMethods = [],
}: {
  file: string;
  tree: ts.SourceFile;
  root?: ts.Node;
  skipMethods?: string[];
}): string[] {
  const methods = methodsOf(tree);
  return literalsIn({ tree, root }).flatMap((literal) => {
    const method = methodAt(methods, literal.offset);
    if (method && isListed(method, skipMethods)) return [];
    const firstLine = lineOf(tree, literal.offset);
    return literal.text
      .split("\n")
      .flatMap((line, index) =>
        HAND_WRITTEN_TENANT_PREDICATE.test(line)
          ? [`${file}:${firstLine + index} ${line.trim()}`]
          : [],
      );
  });
}

/** Whether `name` is the callee of a call, reached directly or as a member. */
function isCalled(name: ts.Node): boolean {
  const parent = name.parent;
  const callee = ts.isPropertyAccessExpression(parent) && parent.name === name ? parent : name;
  return ts.isCallExpression(callee.parent) && callee.parent.expression === callee;
}

/** Whether `name` is a class field or constructor parameter declaring the resolver's type. */
function isDeclaration(name: ts.Node): boolean {
  const owner = name.parent;
  const declares =
    ts.isPropertyDeclaration(owner) || ts.isParameter(owner) || ts.isPropertySignature(owner);
  return declares && owner.name === name;
}

/**
 * Every place a repository reaches a tenant's own client outside the allowed methods: a call of
 * the injected resolver, or taking hold of it so the call happens under another name. The
 * constructor and `create` may store it; a field may declare it.
 */
function clientReachesIn({
  file,
  tree,
  allowedMethods,
}: {
  file: string;
  tree: ts.SourceFile;
  allowedMethods: string[];
}): string[] {
  const methods = methodsOf(tree);
  const reaches: string[] = [];
  walk(tree, (node) => {
    if (!ts.isIdentifier(node) || node.text !== "resolveClient") return true;
    const method = methodAt(methods, node.getStart(tree));
    const where = method?.name ?? "<outside any method>";
    const line = lineOf(tree, node.getStart(tree));
    if (method && isListed(method, allowedMethods)) return true;
    if (isCalled(node)) {
      reaches.push(`${file}:${line} resolves a tenant's client in ${where}`);
    } else if (!isDeclaration(node) && !["constructor", "create"].includes(where)) {
      const isShorthandStore = ts.isShorthandPropertyAssignment(node.parent);
      const isStored =
        ts.isPropertyAccessExpression(node.parent) &&
        ts.isBinaryExpression(node.parent.parent) &&
        node.parent.parent.left === node.parent;
      if (!isShorthandStore && !isStored) {
        reaches.push(`${file}:${line} takes hold of the resolver in ${where}`);
      }
    }
    return true;
  });
  return reaches;
}

/** How many calls under `root` call a function of this name, directly or as a member. */
function callsNamed(root: ts.Node, name: string): number {
  let count = 0;
  walk(root, (node) => {
    if (ts.isIdentifier(node) && node.text === name && isCalled(node)) count += 1;
    return true;
  });
  return count;
}

function notYetConvertedMethodsOf(file: string): string[] {
  return NOT_YET_CONVERTED.filter((entry) => entry.file === file).map((entry) => entry.method);
}

/** Every non-test `.ts` source under `dir`, relative to the workspace root. */
function sourcesUnder(dir: string): string[] {
  const files: string[] = [];
  const visit = (current: string) => {
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      if (entry.name === "node_modules" || entry.name === "dist" || entry.name.startsWith(".")) {
        continue;
      }
      const full = path.join(current, entry.name);
      if (entry.isDirectory()) visit(full);
      else if (/\.tsx?$/.test(entry.name) && !/\.test\.tsx?$/.test(entry.name)) {
        files.push(path.relative(WORKSPACE, full));
      }
    }
  };
  visit(dir);
  return files;
}

/** Whether a source imports or re-exports `name` by name. */
function namesImport({ tree, name }: { tree: ts.SourceFile; name: string }): boolean {
  const clauseOf = (statement: ts.Statement) => {
    if (ts.isImportDeclaration(statement)) return statement.importClause?.namedBindings;
    return ts.isExportDeclaration(statement) ? statement.exportClause : void 0;
  };
  return tree.statements.some((statement) => {
    const clause = clauseOf(statement);
    if (!clause || !("elements" in clause)) return false;
    return clause.elements.some((element) => (element.propertyName ?? element.name).text === name);
  });
}

describe("store calls carry authorization", () => {
  describe("given the fence is the only tenant predicate", () => {
    /** @scenario "Trace repositories write no tenant of their own" */
    it("finds no hand-written tenant predicate in the converted repositories", () => {
      const offending = CONVERTED_REPOSITORIES.flatMap((file) => {
        const tree = parsed(file);
        // A file with no marker is the wrong file, and "nothing offends" would be vacuous.
        expect(
          callsNamed(tree, "tenantScope"),
          `${file} carries no tenantScope marker`,
        ).toBeGreaterThan(0);
        return handWrittenTenantPredicatesIn({
          file,
          tree,
          skipMethods: [...(WRITE_METHODS[file] ?? []), ...notYetConvertedMethodsOf(file)],
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

      expect(handWrittenTenantPredicatesIn({ file: "fixture.ts", tree })).toEqual([
        "fixture.ts:7 WHERE TenantId = {tenantId:String}",
      ]);
    });
  });

  describe("given a repository could reach past the client", () => {
    it("reaches a tenant's own client only from a listed write method", () => {
      const reaches = CONVERTED_REPOSITORIES.flatMap((file) =>
        clientReachesIn({
          file,
          tree: parsed(file),
          allowedMethods: [...(WRITE_METHODS[file] ?? []), ...notYetConvertedMethodsOf(file)],
        }),
      );

      expect(reaches).toEqual([]);
    });

    it.each([
      {
        evasion: "a read whose name starts with a write prefix",
        writeMethods: [],
        source: [
          "export class FixtureRepository {",
          "  async deleteStaleAndFind(tenantId: string) {",
          "    const client = await this.resolveClient(tenantId);",
          '    return client.query({ query: "SELECT 1" });',
          "  }",
          "}",
        ],
        expected: ["fixture.ts:3 resolves a tenant's client in deleteStaleAndFind"],
      },
      {
        evasion: "an arrow property placed right after a write method",
        writeMethods: ["insertSpans"],
        source: [
          "export class FixtureRepository {",
          "  async insertSpans(rows: Row[]) {",
          "    const client = await this.resolveClient(rows[0].tenantId);",
          '    await client.insert({ table: "t", values: rows });',
          "  }",
          "  findStale = async (tenantId: string) => {",
          "    const client = await this.options.resolveClient(tenantId);",
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
          "    const resolve = this.resolveClient;",
          "    const client = await resolve(tenantId);",
          '    return client.query({ query: "SELECT 1" });',
          "  }",
          "}",
        ],
        expected: ["fixture.ts:3 takes hold of the resolver in findAll"],
      },
      {
        evasion: "a resolver only stored by the constructor and typed by a field",
        writeMethods: ["upsert"],
        source: [
          "export class FixtureRepository {",
          "  private readonly resolveClient: Resolver;",
          "  constructor({ resolveClient }: { resolveClient: Resolver }) {",
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
          const found = methods.filter((method) => method.name === name);
          if (found.length === 0) return [`${file} has no method ${name}; remove it from the list`];
          return found.some((method) => callsNamed(method.node, "resolveClient") > 0)
            ? []
            : [`${file}#${name} resolves no client; remove it from the list`];
        });
      });

      expect(stale).toEqual([]);
    });

    it("keeps the not-yet-converted list to methods that still read by tenant id", () => {
      const stale = NOT_YET_CONVERTED.flatMap(({ file, method: name }) => {
        const tree = parsed(file);
        const method = methodsOf(tree).find((candidate) => isListed(candidate, [name]));
        if (!method) return [`${file} has no method ${name}; remove it from the list`];
        const stillByTenantId =
          callsNamed(method.node, "resolveClient") > 0 &&
          handWrittenTenantPredicatesIn({ file, tree, root: method.node }).length > 0;
        return stillByTenantId ? [] : [`${file}#${name} reads through the proof now; remove it`];
      });

      expect(stale).toEqual([]);
    });
  });

  describe("given the fragment expander bypasses the whole-statement check", () => {
    it("is imported by the legacy search read and its own package only", () => {
      const candidates = ["modules", "enterprise/modules", "packages", "apps"].flatMap((root) =>
        sourcesUnder(path.join(WORKSPACE, root)),
      );
      const importers = candidates.filter((file) => {
        const text = readFileSync(path.join(WORKSPACE, file), "utf8");
        if (!text.includes("expandFragment")) return false;
        return (
          namesImport({ tree: parse({ fileName: file, text }), name: "expandFragment" }) ||
          file.startsWith("packages/clickhouse-client/src/authorized-reads")
        );
      });

      expect(importers.toSorted()).toEqual([...FRAGMENT_EXPANDER_CALLERS].toSorted());
    });
  });
});
