import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

import ts from "typescript";

import type { ArchitectureViolation, FeatureCatalogueEntry } from "../../types.ts";
import { getAnchor } from "../../workspace/anchors.ts";
import { listFiles } from "../../workspace/layout.ts";
import {
  mentionMatcher,
  sourceFile,
  sourceText,
  workspaceModuleResolver,
  type WorkspaceModuleResolver,
} from "../../workspace/module-graph.ts";
import type { WorkspaceSnapshot } from "../../workspace/snapshot.ts";

/**
 * The ClickHouse twin of `prisma-table-ownership`. With no schema file or
 * generated client, the table list is replayed from goose migrations and
 * access read from SQL; one module writes a table, everyone else uses its api.
 */

const MIGRATIONS = "packages/clickhouse-migrations/migrations";
const UNOWNED = "unowned";
const TEST_FILE = /(?:__tests__|__fixtures__|\/fixtures\/|\.(?:test|spec)\.)/;
const SOURCE_FILE = /\.[cm]?tsx?$/;
const GOOSE_DOWN = "+goose Down";
const SQL_COMMENT = /--[^\n]*/g;
const DDL =
  /\b(CREATE\s+(?:MATERIALIZED\s+VIEW|TABLE|VIEW)|DROP\s+(?:TABLE|VIEW))\s+(?:IF\s+(?:NOT\s+)?EXISTS\s+)?(?:\$\{[^}]*\}\.)?([A-Za-z_]\w*)/gi;
const VERB =
  "(FROM|JOIN|INSERT\\s+INTO|ALTER\\s+TABLE|TRUNCATE\\s+TABLE|OPTIMIZE\\s+TABLE|DELETE\\s+FROM)";
const DATABASE_PREFIX = "(?:\\$\\{[^}]*\\}\\.)?";
const NAMED_TABLE = new RegExp(`\\b${VERB}\\s+${DATABASE_PREFIX}\`?([A-Za-z_]\\w*)\`?`, "gi");
const SUBSTITUTED_TABLE = new RegExp(
  `\\b${VERB}\\s+${DATABASE_PREFIX}\\$\\{\\s*([A-Za-z_$][\\w$]*)\\s*\\}`,
  "gi",
);
const NAMES_TABLE_BY_BINDING = new RegExp(
  `\\b${VERB}\\s+${DATABASE_PREFIX}\\$\\{|\\btable\\s*:\\s*[A-Za-z_$]`,
  "i",
);
const READING_VERBS = new Set(["from", "join"]);

export type Access = { module: string; table: string; file: string; line: number; write: boolean };
type ScanRoot = { module: string; directory: string };

const ALLOWED =
  "Write a ClickHouse table from one module's repositories only, and read it elsewhere through that module's api. See ADR-134.";

/** A table no module writes, recorded with who does and why (Alex, 2026-10-06, Q207). */
export type OwnershipRecord = {
  table: string;
  owner: "framework" | "legacy";
  writer: string;
  reason: string;
};

/** A foreign read inside one statement, which an `*Api` call cannot express (Q207). */
export type NamedException = { reader: string; table: string; file: string; reason: string };

/** A table its writing module shares for reading with named modules; writes stay its own (EF-5). */
export type SharedTable = {
  table: string;
  owner: string;
  readers: readonly string[];
  reason: string;
};

export type DeclaredOwnership = {
  records: readonly OwnershipRecord[];
  exceptions: readonly NamedException[];
  shared: readonly SharedTable[];
};

const LEGACY = "no writer on this release";
const SUBQUERY =
  "a WHERE-clause subquery inside trace's one statement; an *Api call can only return an unbounded id list";

export const DECLARED_OWNERSHIP: DeclaredOwnership = {
  records: [
    {
      table: "event_log",
      owner: "framework",
      writer: "packages/eventing",
      reason:
        "the event store appends every pipeline's events; modules reach it through eventing (§7)",
    },
    {
      table: "stored_log_records",
      owner: "legacy",
      writer: LEGACY,
      reason:
        "predates log_records; only a release still rolling out writes it, trace reads it as a fallback",
    },
    {
      table: "stored_metric_records",
      owner: "legacy",
      writer: LEGACY,
      reason: "predates metric_records; kept for the LWQL legacy view, nothing writes it",
    },
    {
      table: "stored_objects",
      owner: "legacy",
      writer: LEGACY,
      reason: "read-only legacy index of externalised content (ADR-158); stored-object reads it",
    },
    {
      table: "automation_audit",
      owner: "legacy",
      writer: LEGACY,
      reason: "retired: its writer is gone (ADR-052, 2026-07 amendment); kept, never dropped",
    },
    {
      table: "langy_messages",
      owner: "legacy",
      writer: LEGACY,
      reason: "Langy conversation content (migration 00036), still read; no module writes it here",
    },
  ],
  exceptions: [
    {
      reader: "trace",
      table: "instant_eval_judgments",
      file: "modules/trace/process/src/features/query/repositories/clickhouse/clickhouse.trace-query-subquery.mapper.ts",
      reason: SUBQUERY,
    },
    {
      reader: "trace",
      table: "simulation_runs",
      file: "modules/trace/process/src/features/query/repositories/clickhouse/clickhouse.trace-query-subquery.mapper.ts",
      reason: SUBQUERY,
    },
    {
      reader: "evaluation",
      table: "trace_summaries",
      file: "modules/evaluation/process/src/repositories/clickhouse/monitor-performance.repository.ts",
      reason:
        "a JOIN inside evaluation's one statement; an *Api call can only return an unbounded id list",
    },
  ],
  shared: [
    {
      table: "trace_analytics",
      owner: "trace",
      readers: ["analytics"],
      reason: "trace folds it from its facts for analytics' dashboards to read (EF-5, 2026-10-07)",
    },
    {
      table: "trace_analytics_rollup",
      owner: "trace",
      readers: ["analytics"],
      reason: "trace appends it per span for analytics' dashboards to read (EF-5, 2026-10-07)",
    },
    {
      table: "trace_summaries",
      owner: "trace",
      readers: ["analytics"],
      reason:
        "analytics' custom-graph aggregations select over trace's summaries (EF-5, 2026-10-07)",
    },
    {
      table: "stored_spans",
      owner: "trace",
      readers: ["analytics"],
      reason: "analytics' span-level aggregations select over trace's spans (EF-5, 2026-10-07)",
    },
    {
      table: "evaluation_runs",
      owner: "evaluation",
      readers: ["analytics", "trace"],
      reason:
        "analytics' evaluation metrics and trace's evaluation joins and facets select over evaluation's runs (EF-5; R40, 2026-10-07)",
    },
    {
      table: "gateway_spend",
      owner: "gateway",
      readers: ["billing"],
      reason:
        "billing sums a connected customer's confirmed spend per request type for its statement and term cap (round 37 D5, EF-5)",
    },
    {
      table: "gateway_budget_ledger_events",
      owner: "gateway",
      readers: ["billing"],
      reason:
        "billing sums the contract budget's bucket since its window opened, the spend the gateway enforces (C3a D5, Alex 2026-10-10)",
    },
    {
      table: "log_records",
      owner: "log",
      readers: ["trace"],
      reason:
        "trace's log read and session groups select over log's records, never a copy (R40, 2026-10-07)",
    },
    {
      table: "instant_eval_runs",
      owner: "instant-eval",
      readers: ["trace"],
      reason:
        "trace dates the runs an Explorer eval chip claims from instant-eval's runs, not an InstantEvalApi call (R40; round 47, 2026-10-08)",
    },
  ],
};

function issue(file: string, message: string, line?: number): ArchitectureViolation {
  return { policy: "clickhouse-table-ownership", file, line, message, allowed: ALLOWED };
}

/** The `+goose Up` half of a migration, with its SQL comments removed. */
export function upStatements(text: string): string {
  const down = text.indexOf(GOOSE_DOWN);

  return (down < 0 ? text : text.slice(0, down)).replace(SQL_COMMENT, "");
}

/**
 * The tables the migrations leave behind, mapped to the migration that
 * created them. A materialised view folds onto the table it feeds, so a
 * `*_mv` pair counts as one table with one owner.
 */
export function clickhouseTables(root: string): Map<string, string> {
  const directory = getAnchor({ root, anchor: MIGRATIONS, policy: "clickhouse-table-ownership" });
  const live = new Map<string, string>();

  for (const name of readdirSync(directory)
    .filter((file) => file.endsWith(".sql"))
    .toSorted()) {
    const statements = upStatements(readFileSync(join(directory, name), "utf8"));

    for (const match of statements.matchAll(DDL)) {
      const table = match[2];
      if (!table) continue;

      if (/^create/i.test(match[1] ?? "")) live.set(table, `${MIGRATIONS}/${name}`);
      else live.delete(table);
    }
  }

  return foldMaterialisedViews(live);
}

const VIEW_NAME = "(?:\\$\\{[^}]*\\}\\.)?([A-Za-z_]\\w*)";
const VIEW_CREATE = new RegExp(
  `CREATE\\s+MATERIALIZED\\s+VIEW\\s+(?:IF\\s+NOT\\s+EXISTS\\s+)?${VIEW_NAME}\\s+(?:ON\\s+CLUSTER\\s+\\S+\\s+)?TO\\s+${VIEW_NAME}([^;]*)`,
  "gi",
);
const VIEW_DROP = new RegExp(`DROP\\s+VIEW\\s+(?:IF\\s+EXISTS\\s+)?${VIEW_NAME}`, "gi");
const VIEW_SOURCE = new RegExp(`\\bFROM\\s+${VIEW_NAME}`, "i");

type ViewEvent = { index: number; view: string; feed?: { target: string; source?: string } };

function viewEvents(statements: string): ViewEvent[] {
  const events: ViewEvent[] = [];

  for (const match of statements.matchAll(VIEW_CREATE)) {
    const [, view, target, body] = match;
    if (!view || !target) continue;

    events.push({
      index: match.index,
      view,
      feed: { target, source: VIEW_SOURCE.exec(body ?? "")?.[1] },
    });
  }

  for (const match of statements.matchAll(VIEW_DROP)) {
    if (match[1]) events.push({ index: match.index, view: match[1] });
  }

  return events.toSorted((left, right) => left.index - right.index);
}

/**
 * The tables each live materialised view reads, keyed by the table it writes
 * to. A target no module inserts into is fed by the module that writes its
 * source, so the view's target takes that source's owner.
 */
export function clickhouseViewFeeds(root: string): Map<string, string[]> {
  const directory = getAnchor({ root, anchor: MIGRATIONS, policy: "clickhouse-table-ownership" });
  const live = new Map<string, { target: string; source?: string }>();

  for (const name of readdirSync(directory)
    .filter((file) => file.endsWith(".sql"))
    .toSorted()) {
    for (const event of viewEvents(upStatements(readFileSync(join(directory, name), "utf8")))) {
      if (event.feed) live.set(event.view, event.feed);
      else live.delete(event.view);
    }
  }

  const feeds = new Map<string, string[]>();

  for (const { target, source } of live.values()) {
    if (source) feeds.set(target, [...(feeds.get(target) ?? []), source]);
  }

  return feeds;
}

function foldMaterialisedViews(live: ReadonlyMap<string, string>): Map<string, string> {
  const folded = new Map<string, string>();

  for (const [table, migration] of live) {
    const target = table.endsWith("_mv") ? table.slice(0, -"_mv".length) : table;
    if (!folded.has(target) || target === table) folded.set(target, migration);
  }

  return folded;
}

/** The directories a module's ClickHouse access can live in: its catalogue root. */
function scanRoots(root: string, catalogue: readonly FeatureCatalogueEntry[]): ScanRoot[] {
  return catalogue.map((feature) => ({
    module: feature.id,
    directory: join(root, feature.root),
  }));
}

/** File-level `const NAME = "table"` bindings, so `FROM ${NAME}` resolves. */
function literalConstants(source: ts.SourceFile): Map<string, string> {
  const constants = new Map<string, string>();

  for (const statement of source.statements.filter(ts.isVariableStatement)) {
    for (const declaration of statement.declarationList.declarations) {
      if (!ts.isIdentifier(declaration.name)) continue;

      const initialiser = declaration.initializer;
      if (!initialiser) continue;

      const value = ts.isAsExpression(initialiser) ? initialiser.expression : initialiser;
      if (ts.isStringLiteralLike(value)) constants.set(declaration.name.text, value.text);
    }
  }

  return constants;
}

type ConstantScope = {
  resolver: WorkspaceModuleResolver;
  scopes: Map<string, ReadonlyMap<string, string>>;
  cut: { count: number };
};

const MAX_IMPORT_DEPTH = 8;

function importedNames(statement: ts.ImportDeclaration): { local: string; imported: string }[] {
  const bindings = statement.importClause?.namedBindings;
  if (!bindings || !ts.isNamedImports(bindings)) return [];

  return bindings.elements.map((element) => ({
    local: element.name.text,
    imported: (element.propertyName ?? element.name).text,
  }));
}

type Through = (specifier: string) => ReadonlyMap<string, string>;

function addMissing(constants: Map<string, string>, name: string, value: string | undefined): void {
  if (value !== undefined && !constants.has(name)) constants.set(name, value);
}

function addImports(constants: Map<string, string>, statement: ts.Statement, through: Through) {
  if (!ts.isImportDeclaration(statement) || !ts.isStringLiteralLike(statement.moduleSpecifier))
    return;

  const target = through(statement.moduleSpecifier.text);

  for (const { local, imported } of importedNames(statement))
    addMissing(constants, local, target.get(imported));
}

function addReExports(constants: Map<string, string>, statement: ts.Statement, through: Through) {
  if (!ts.isExportDeclaration(statement) || !statement.moduleSpecifier) return;

  if (!ts.isStringLiteralLike(statement.moduleSpecifier)) return;

  const target = through(statement.moduleSpecifier.text);
  const clause = statement.exportClause;

  if (!clause) {
    for (const [name, value] of target) addMissing(constants, name, value);

    return;
  }

  if (!ts.isNamedExports(clause)) return;

  for (const element of clause.elements)
    addMissing(
      constants,
      element.name.text,
      target.get((element.propertyName ?? element.name).text),
    );
}

/**
 * Every table-name constant a file can name: its own, those it imports by name
 * and those it re-exports. The reader stays the importing file, so a constant
 * naming another module's table keeps the read a foreign read.
 */
function constantsOf({
  file,
  scope,
  trail = [],
}: {
  file: string;
  scope: ConstantScope;
  trail?: readonly string[];
}): ReadonlyMap<string, string> {
  const known = scope.scopes.get(file);
  if (known) return known;

  if (trail.includes(file) || trail.length >= MAX_IMPORT_DEPTH) {
    scope.cut.count += 1;

    return new Map();
  }

  const cutBefore = scope.cut.count;
  const source = sourceFile({ file });
  const constants = literalConstants(source);
  const through: Through = (specifier) => {
    const target = scope.resolver.resolve({ specifier, file });

    return target ? constantsOf({ file: target, scope, trail: [...trail, file] }) : new Map();
  };

  for (const statement of source.statements) {
    addImports(constants, statement, through);
    addReExports(constants, statement, through);
  }

  if (scope.cut.count === cutBefore) scope.scopes.set(file, constants);

  return constants;
}

type Reader = {
  source: ts.SourceFile;
  module: string;
  tables: ReadonlyMap<string, string>;
  constant: (name: string) => string | undefined;
  found: Access[];
};

function record({
  reader,
  node,
  table,
  write,
}: {
  reader: Reader;
  node: ts.Node;
  table: string;
  write: boolean;
}): void {
  if (!reader.tables.has(table)) return;

  const line = reader.source.getLineAndCharacterOfPosition(node.getStart(reader.source)).line + 1;
  reader.found.push({ module: reader.module, table, file: reader.source.fileName, line, write });
}

/** Every table a SQL literal names, with the verb that says whether it is written. */
function readSql(reader: Reader, node: ts.Node): void {
  const text = node.getText(reader.source);

  for (const match of text.matchAll(NAMED_TABLE)) {
    const table = match[2];
    if (table)
      record({ reader, node, table, write: !READING_VERBS.has((match[1] ?? "").toLowerCase()) });
  }

  for (const match of text.matchAll(SUBSTITUTED_TABLE)) {
    const table = reader.constant(match[2] ?? "");
    if (table)
      record({ reader, node, table, write: !READING_VERBS.has((match[1] ?? "").toLowerCase()) });
  }
}

function insertedTable(reader: Reader, node: ts.CallExpression): string | undefined {
  if (!ts.isPropertyAccessExpression(node.expression)) return void 0;

  if (node.expression.name.text !== "insert") return void 0;

  const [options] = node.arguments;
  if (!options || !ts.isObjectLiteralExpression(options)) return void 0;

  const property = options.properties.find(
    (entry): entry is ts.PropertyAssignment =>
      ts.isPropertyAssignment(entry) && ts.isIdentifier(entry.name) && entry.name.text === "table",
  );

  if (!property) return void 0;

  const value = property.initializer;
  if (ts.isStringLiteralLike(value)) return value.text;

  if (ts.isTemplateExpression(value)) return qualifiedConstant(reader, value);

  return ts.isIdentifier(value) ? reader.constant(value.text) : void 0;
}

/** `${database}.${CONSTANT}`: the table is the declared constant after the database dot. */
function qualifiedConstant(reader: Reader, template: ts.TemplateExpression): string | undefined {
  const spans = template.templateSpans;
  const last = spans[spans.length - 1];
  if (!last || spans.length < 2 || last.literal.text !== "") return void 0;

  if (!ts.isIdentifier(last.expression)) return void 0;

  const before = spans[spans.length - 2]?.literal.text;
  return before === "." ? reader.constant(last.expression.text) : void 0;
}

function readFile({
  file,
  module,
  tables,
  mentionsTable,
  scope,
  found,
}: {
  file: string;
  module: string;
  tables: ReadonlyMap<string, string>;
  mentionsTable: (file: string) => boolean;
  scope: ConstantScope;
  found: Access[];
}): void {
  const text = sourceText({ file });
  if (!/from|join|into|table/i.test(text)) return;

  const bound = NAMES_TABLE_BY_BINDING.test(text);
  if (!bound && !mentionsTable(file)) return;

  const source = sourceFile({ file });
  const local = literalConstants(source);
  const constant = (name: string): string | undefined =>
    local.get(name) ?? constantsOf({ file, scope }).get(name);
  const reader: Reader = { source, module, tables, constant, found };

  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteralLike(node)) readSql(reader, node);

    if (ts.isTemplateExpression(node)) readSql(reader, node);

    if (ts.isCallExpression(node)) {
      const table = insertedTable(reader, node);
      if (table) record({ reader, node, table, write: true });
    }

    ts.forEachChild(node, visit);
  };

  visit(source);
}

/** Every module access to a live ClickHouse table, in a stable file order. */
export function collectAccess(
  root: string,
  catalogue: readonly FeatureCatalogueEntry[],
  tables: ReadonlyMap<string, string>,
): Access[] {
  const found: Access[] = [];
  const mentionsTable = mentionMatcher({ words: tables.keys() });
  const scope: ConstantScope = {
    resolver: workspaceModuleResolver({ root }),
    scopes: new Map(),
    cut: { count: 0 },
  };

  for (const scan of scanRoots(root, catalogue)) {
    if (!existsSync(scan.directory)) continue;

    const files = listFiles({
      directory: scan.directory,
      accept: (file) => SOURCE_FILE.test(file) && !TEST_FILE.test(file),
    });

    for (const file of [...files].toSorted())
      readFile({ file, module: scan.module, tables, mentionsTable, scope, found });
  }

  return found.toSorted(
    (left, right) => left.file.localeCompare(right.file) || left.line - right.line,
  );
}

type Finding = { key: string; file: string; line?: number; message: string };

/** The module that writes a table, or else owns the source of the view feeding it. */
function ownerOf({
  table,
  writers,
  feeds,
  seen = new Set(),
}: {
  table: string;
  writers: ReadonlyMap<string, Access[]>;
  feeds: ReadonlyMap<string, readonly string[]>;
  seen?: Set<string>;
}): Access | undefined {
  const direct = writers.get(table)?.[0];
  if (direct || seen.has(table)) return direct;

  seen.add(table);

  for (const source of feeds.get(table) ?? []) {
    const fed = ownerOf({ table: source, writers, feeds, seen });
    if (fed) return fed;
  }

  return void 0;
}

/** The one module that writes each table, in the order the tree declares them. */
function owners(access: readonly Access[]): Map<string, Access[]> {
  const writers = new Map<string, Access[]>();

  for (const entry of access.filter((item) => item.write)) {
    const modules = writers.get(entry.table) ?? [];
    if (!modules.some((item) => item.module === entry.module)) modules.push(entry);

    writers.set(entry.table, modules);
  }

  return writers;
}

type Feeds = ReadonlyMap<string, readonly string[]>;

/** A recorded table no migration creates, or a module writing one. */
function recordFindings({
  tables,
  writers,
  records,
  root,
}: {
  tables: ReadonlyMap<string, string>;
  writers: ReadonlyMap<string, Access[]>;
  records: readonly OwnershipRecord[];
  root: string;
}): Finding[] {
  return records.flatMap((record): Finding[] => {
    if (!tables.has(record.table)) {
      return [
        {
          key: `record|${record.table}`,
          file: join(root, MIGRATIONS),
          message: `Table ${record.table} is recorded as ${record.owner} owned but no migration creates it. Delete the record.`,
        },
      ];
    }

    return (writers.get(record.table) ?? []).map((writer) => ({
      key: `${writer.module}|${record.table}`,
      file: writer.file,
      line: writer.line,
      message: `${writer.module} writes ${record.table}, recorded as ${record.owner} owned (${record.writer}: ${record.reason}).`,
    }));
  });
}

function isExcepted({
  entry,
  exceptions,
  root,
}: {
  entry: Access;
  exceptions: readonly NamedException[];
  root: string;
}): boolean {
  const file = relative(root, entry.file);

  return exceptions.some(
    (item) => item.reader === entry.module && item.table === entry.table && item.file === file,
  );
}

/** A named exception the tree no longer needs is deleted, so the list cannot widen silently. */
function staleExceptions({
  access,
  exceptions,
  root,
}: {
  access: readonly Access[];
  exceptions: readonly NamedException[];
  root: string;
}): Finding[] {
  return exceptions
    .filter((item) => !access.some((entry) => isExcepted({ entry, exceptions: [item], root })))
    .map((item) => ({
      key: `exception|${item.reader}|${item.table}|${item.file}`,
      file: join(root, item.file),
      message: `The named exception for ${item.reader} reading ${item.table} in ${item.file} matches no read. Delete it.`,
    }));
}

/** A read its owner declared shared with the reading module. */
function isSharedRead({
  entry,
  owner,
  shared,
}: {
  entry: Access;
  owner: string;
  shared: readonly SharedTable[];
}): boolean {
  return (
    !entry.write &&
    shared.some(
      (item) =>
        item.table === entry.table && item.owner === owner && item.readers.includes(entry.module),
    )
  );
}

/** A shared table its declared owner does not own, or a named reader that no longer reads it. */
function staleShared({
  access,
  tables,
  writers,
  feeds,
  shared,
  root,
}: {
  access: readonly Access[];
  tables: ReadonlyMap<string, string>;
  writers: ReadonlyMap<string, Access[]>;
  feeds: Feeds;
  shared: readonly SharedTable[];
  root: string;
}): Finding[] {
  return shared.flatMap((item): Finding[] => {
    const owner = tables.has(item.table) ? ownerOf({ table: item.table, writers, feeds }) : void 0;

    if (owner?.module !== item.owner) {
      return [
        {
          key: `shared|${item.table}`,
          file: join(root, MIGRATIONS),
          message: `Table ${item.table} is declared shared by ${item.owner}, which does not own it. Fix or delete the declaration.`,
        },
      ];
    }

    return item.readers
      .filter(
        (reader) => !access.some((entry) => entry.module === reader && entry.table === item.table),
      )
      .map((reader) => ({
        key: `shared|${item.table}|${reader}`,
        file: owner.file,
        message: `Table ${item.table} is shared with ${reader}, which no longer reads it. Delete the reader.`,
      }));
  });
}

type TableContext = {
  access: readonly Access[];
  writers: ReadonlyMap<string, Access[]>;
  feeds: Feeds;
  root: string;
  exceptions: readonly NamedException[];
  shared: readonly SharedTable[];
  findings: Map<string, Finding>;
};

/** One module-owned table: no owner, a second writer, or a foreign reader. */
function addTableFindings({
  table,
  migration,
  context,
}: {
  table: string;
  migration: string;
  context: TableContext;
}): void {
  const { access, writers, feeds, root, exceptions, shared, findings } = context;
  const owner = ownerOf({ table, writers, feeds });

  if (!owner) {
    findings.set(`${UNOWNED}|${table}`, {
      key: `${UNOWNED}|${table}`,
      file: join(root, migration),
      message: `Table ${table} has no module owner.`,
    });

    return;
  }

  for (const extra of (writers.get(table) ?? []).slice(1)) {
    const key = `${extra.module}|${table}`;

    findings.set(key, {
      key,
      file: extra.file,
      line: extra.line,
      message: `Table ${table} is written by ${extra.module} and ${owner.module} (${relative(root, owner.file)}). Keep a single module owner.`,
    });
  }

  for (const entry of access.filter((item) => item.table === table)) {
    const key = `${entry.module}|${table}`;
    if (entry.module === owner.module || findings.has(key)) continue;
    if (isExcepted({ entry, exceptions, root })) continue;
    if (isSharedRead({ entry, owner: owner.module, shared })) continue;

    findings.set(key, {
      key,
      file: entry.file,
      line: entry.line,
      message: `${entry.module} reads ${table}, owned by ${owner.module}.`,
    });
  }
}

function collectFindings({
  access,
  tables,
  feeds,
  root,
  declared,
}: {
  access: readonly Access[];
  tables: ReadonlyMap<string, string>;
  feeds: Feeds;
  root: string;
  declared: DeclaredOwnership;
}): Finding[] {
  const writers = owners(access);
  const recorded = new Set(declared.records.map((record) => record.table));
  const findings = new Map<string, Finding>();
  const { exceptions, shared } = declared;
  const context = { access, writers, feeds, root, exceptions, shared, findings };

  for (const [table, migration] of [...tables].toSorted(([a], [b]) => a.localeCompare(b))) {
    if (!recorded.has(table)) addTableFindings({ table, migration, context });
  }

  return [
    ...findings.values(),
    ...recordFindings({ tables, writers, records: declared.records, root }),
    ...staleExceptions({ access, exceptions, root }),
    ...staleShared({ access, tables, writers, feeds, shared, root }),
  ];
}

/** One read of the tree: the table list, every access and the view feeds. */
export type ClickhouseScan = {
  tables: ReadonlyMap<string, string>;
  access: readonly Access[];
  feeds: Feeds;
};

export function clickhouseScanAt(
  root: string,
  catalogue: readonly FeatureCatalogueEntry[],
): ClickhouseScan {
  const tables = clickhouseTables(root);

  return {
    tables,
    access: collectAccess(root, catalogue, tables),
    feeds: clickhouseViewFeeds(root),
  };
}

const scans = new WeakMap<WorkspaceSnapshot, ClickhouseScan>();

/** The scan once per snapshot: this policy and `migration-owners` share it in one run. */
export function clickhouseScanOf(snapshot: WorkspaceSnapshot): ClickhouseScan {
  const cached = scans.get(snapshot);
  if (cached) return cached;
  const scan = clickhouseScanAt(snapshot.root, snapshot.catalogue);
  scans.set(snapshot, scan);

  return scan;
}

/** A framework table is its writing package's; every legacy table is one owner, `legacy`. */
function recordedOwner(record: OwnershipRecord): string {
  return record.owner === "framework" ? record.writer : "legacy";
}

/** Each table's owner: its writing module, its view source's, or its record (D3). */
export function clickhouseTableOwners({
  scan,
  declared = DECLARED_OWNERSHIP,
}: {
  scan: ClickhouseScan;
  declared?: DeclaredOwnership;
}): Map<string, string> {
  const writers = owners(scan.access);
  const result = new Map<string, string>();

  for (const table of scan.tables.keys()) {
    const record = declared.records.find((item) => item.table === table);
    const owner = record
      ? recordedOwner(record)
      : ownerOf({ table, writers, feeds: scan.feeds })?.module;
    if (owner) result.set(table, owner);
  }

  return result;
}

const NOTHING_DECLARED: DeclaredOwnership = { records: [], exceptions: [], shared: [] };

/** Every finding under a root; fixtures pass declarations, the registry the ruled ones. */
export function collectClickhouseOwnershipFindings(
  root: string,
  catalogue: readonly FeatureCatalogueEntry[],
  declared: DeclaredOwnership = NOTHING_DECLARED,
): Finding[] {
  return collectFindings({ ...clickhouseScanAt(root, catalogue), root, declared });
}

/** A foreign reader, a second writer or an ownerless table is a violation. */
export function lintClickhouseTableOwnershipAt({
  root,
  catalogue,
}: {
  root: string;
  catalogue: readonly FeatureCatalogueEntry[];
}): ArchitectureViolation[] {
  return collectClickhouseOwnershipFindings(root, catalogue).map((finding) =>
    issue(finding.file, finding.message, finding.line),
  );
}

/** The registry entry. The records describe this schema; a schema-less workspace has none. */
export function lintClickhouseTableOwnership(snapshot: WorkspaceSnapshot): ArchitectureViolation[] {
  const { root } = snapshot;
  const scan = clickhouseScanOf(snapshot);
  const declared = scan.tables.size === 0 ? NOTHING_DECLARED : DECLARED_OWNERSHIP;

  return collectFindings({ ...scan, root, declared }).map((finding) =>
    issue(finding.file, finding.message, finding.line),
  );
}
