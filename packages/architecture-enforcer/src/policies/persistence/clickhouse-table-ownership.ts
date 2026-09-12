import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import ts from "typescript";
import {
  type BaselineEntry,
  type BaselinePolicy,
  baselinePath,
  collectBaseline,
  emptyBaselineRows,
  liveKeys,
  readBaseline,
  staleRows,
} from "../../baseline.ts";
import { walkFiles } from "../../workspace/layout.ts";
import { sourceText } from "../../workspace/module-graph.ts";
import type { WorkspaceSnapshot } from "../../workspace/snapshot.ts";
import type { ArchitectureViolation, FeatureCatalogueEntry } from "../../types.ts";

/**
 * The ClickHouse twin of `prisma-table-ownership`. ClickHouse has no schema
 * file and no generated client, so the table list is replayed from the goose
 * migrations and access is read out of the SQL a module writes. One module
 * writes a table; everybody else goes through that module's api.
 */

const MIGRATIONS = "packages/clickhouse-client/migrations";
const BASELINE_FILE = "clickhouse-table-ownership-baseline.json";
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
const READING_VERBS = new Set(["from", "join"]);

const APPLICATION_FEATURE_ROOTS = [
  "apps/api/src/features",
  "apps/worker/src/features",
  "apps/tasks/src/features",
];
const COMPOSITION_ROOTS = [
  "enterprise/packages/composition/api/src",
  "enterprise/packages/composition/worker/src",
];

type Access = { module: string; table: string; file: string; line: number; write: boolean };
type ScanRoot = { module: string; directory: string };

const ALLOWED =
  "Write a ClickHouse table from one module's repositories only, and read it elsewhere through that module's api. See ADR-134.";

function issue(file: string, message: string, line?: number): ArchitectureViolation {
  return { policy: "clickhouse-table-ownership", file, line, message, allowed: ALLOWED };
}

/** The `+goose Up` half of a migration, with its SQL comments removed. */
function upStatements(text: string): string {
  const down = text.indexOf(GOOSE_DOWN);

  return (down < 0 ? text : text.slice(0, down)).replace(SQL_COMMENT, "");
}

/**
 * The tables the migrations leave behind, mapped to the migration that
 * created them. A materialised view folds onto the table it feeds, so a
 * `*_mv` pair counts as one table with one owner.
 */
export function clickhouseTables(root: string): Map<string, string> {
  const directory = join(root, MIGRATIONS);
  const live = new Map<string, string>();
  if (!existsSync(directory)) return live;

  for (const name of readdirSync(directory)
    .filter((file) => file.endsWith(".sql"))
    .sort()) {
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

function foldMaterialisedViews(live: ReadonlyMap<string, string>): Map<string, string> {
  const folded = new Map<string, string>();
  for (const [table, migration] of live) {
    const target = table.endsWith("_mv") ? table.slice(0, -"_mv".length) : table;
    if (!folded.has(target) || target === table) folded.set(target, migration);
  }

  return folded;
}

/** The directories a module's ClickHouse access can live in, module by module. */
function scanRoots(root: string, catalogue: readonly FeatureCatalogueEntry[]): ScanRoot[] {
  const ids = new Set(catalogue.map((feature) => feature.id));
  const roots = catalogue.map((feature) => ({
    module: feature.id,
    directory: join(root, feature.root),
  }));

  for (const parent of [...APPLICATION_FEATURE_ROOTS, ...COMPOSITION_ROOTS]) {
    const directory = join(root, parent);
    if (!existsSync(directory)) continue;

    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      if (entry.isDirectory() && ids.has(entry.name)) {
        roots.push({ module: entry.name, directory: join(directory, entry.name) });
      }
    }
  }

  return roots;
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

type Reader = {
  source: ts.SourceFile;
  module: string;
  tables: ReadonlyMap<string, string>;
  constants: ReadonlyMap<string, string>;
  found: Access[];
};

function record(reader: Reader, node: ts.Node, table: string, write: boolean): void {
  if (!reader.tables.has(table)) return;

  const line = reader.source.getLineAndCharacterOfPosition(node.getStart(reader.source)).line + 1;
  reader.found.push({ module: reader.module, table, file: reader.source.fileName, line, write });
}

/** Every table a SQL literal names, with the verb that says whether it is written. */
function readSql(reader: Reader, node: ts.Node): void {
  const text = node.getText(reader.source);
  for (const match of text.matchAll(NAMED_TABLE)) {
    const table = match[2];
    if (table) record(reader, node, table, !READING_VERBS.has((match[1] ?? "").toLowerCase()));
  }

  for (const match of text.matchAll(SUBSTITUTED_TABLE)) {
    const table = reader.constants.get(match[2] ?? "");
    if (table) record(reader, node, table, !READING_VERBS.has((match[1] ?? "").toLowerCase()));
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

  return ts.isIdentifier(value) ? reader.constants.get(value.text) : void 0;
}

function readFile({
  file,
  module,
  tables,
  found,
}: {
  file: string;
  module: string;
  tables: ReadonlyMap<string, string>;
  found: Access[];
}): void {
  const text = sourceText({ file });
  if (!/from|join|into|table/i.test(text)) return;

  const source = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, true);
  const reader: Reader = { source, module, tables, constants: literalConstants(source), found };
  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteralLike(node) || ts.isTemplateExpression(node)) readSql(reader, node);

    if (ts.isCallExpression(node)) {
      const table = insertedTable(reader, node);
      if (table) record(reader, node, table, true);
    }

    ts.forEachChild(node, visit);
  };
  visit(source);
}

/** Every module access to a live ClickHouse table, in a stable file order. */
function collectAccess(
  root: string,
  catalogue: readonly FeatureCatalogueEntry[],
  tables: ReadonlyMap<string, string>,
): Access[] {
  const found: Access[] = [];
  for (const scan of scanRoots(root, catalogue)) {
    if (!existsSync(scan.directory)) continue;

    const files = walkFiles(
      scan.directory,
      (file) => SOURCE_FILE.test(file) && !TEST_FILE.test(file),
    );
    for (const file of files.sort()) readFile({ file, module: scan.module, tables, found });
  }

  return found.sort((left, right) => left.file.localeCompare(right.file) || left.line - right.line);
}

type Finding = { key: string; file: string; line?: number; message: string };

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

function collectFindings(
  access: readonly Access[],
  tables: ReadonlyMap<string, string>,
  root: string,
): Finding[] {
  const writers = owners(access);
  const findings = new Map<string, Finding>();
  for (const [table, migration] of [...tables].sort()) {
    const modules = writers.get(table) ?? [];
    const owner = modules[0];
    if (!owner) {
      findings.set(`${UNOWNED}|${table}`, {
        key: `${UNOWNED}|${table}`,
        file: join(root, migration),
        message: `Table ${table} has no module owner.`,
      });
      continue;
    }

    for (const extra of modules.slice(1)) {
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

      findings.set(key, {
        key,
        file: entry.file,
        line: entry.line,
        message: `${entry.module} reads ${table}, owned by ${owner.module}.`,
      });
    }
  }

  return [...findings.values()];
}

/** Every finding this tree carries, keyed for the baseline. */
export function collectClickhouseOwnershipFindings(
  root: string,
  catalogue: readonly FeatureCatalogueEntry[],
): Finding[] {
  const tables = clickhouseTables(root);
  if (tables.size === 0) return [];

  return collectFindings(collectAccess(root, catalogue, tables), tables, root);
}

export const CLICKHOUSE_TABLE_OWNERSHIP_BASELINE: BaselinePolicy = {
  id: "clickhouse-table-ownership",
  file: BASELINE_FILE,
  label: "ClickHouse table ownership baseline",
  keyRule: "A key is `<module>|<table>`; the module `unowned` marks a table no module writes.",
  enforceExpiry: false,
  stale: (entry) => ({
    message: `ClickHouse table ownership baseline entry ${entry.key.split("|").join("/")} no longer matches anything and must be removed.`,
    allowed: "Delete the stale entry so the checked-in inventory only shrinks.",
  }),
};

export function collectClickhouseTableOwnershipBaseline({
  root,
  catalogue,
  previous = [],
}: {
  root: string;
  catalogue: readonly FeatureCatalogueEntry[];
  previous?: readonly BaselineEntry[];
}): BaselineEntry[] {
  const found = collectClickhouseOwnershipFindings(root, catalogue).map((finding) => finding.key);

  return collectBaseline({ policy: CLICKHOUSE_TABLE_OWNERSHIP_BASELINE, found, previous });
}

/**
 * The ratchet: an unlisted foreign reader, second writer or ownerless table is
 * a violation, and a listed one that is gone is stale.
 */
export function lintClickhouseTableOwnershipAt({
  root,
  catalogue,
}: {
  root: string;
  catalogue: readonly FeatureCatalogueEntry[];
}): ArchitectureViolation[] {
  const file = baselinePath({ root, policy: CLICKHOUSE_TABLE_OWNERSHIP_BASELINE });
  const baseline = readBaseline({ policy: CLICKHOUSE_TABLE_OWNERSHIP_BASELINE, file });
  const violations = [
    ...baseline.violations,
    ...emptyBaselineRows({ read: baseline, policy: CLICKHOUSE_TABLE_OWNERSHIP_BASELINE, file }),
  ];

  const findings = collectClickhouseOwnershipFindings(root, catalogue);
  const baselined = liveKeys({ entries: baseline.entries });
  for (const finding of findings) {
    if (baselined.has(finding.key)) continue;

    violations.push(issue(finding.file, finding.message, finding.line));
  }

  violations.push(
    ...staleRows({
      entries: baseline.entries,
      found: new Set(findings.map((finding) => finding.key)),
      policy: CLICKHOUSE_TABLE_OWNERSHIP_BASELINE,
      file,
    }),
  );

  return violations;
}

/** The registry entry: the same check, reading the catalogue off a snapshot. */
export function lintClickhouseTableOwnership(snapshot: WorkspaceSnapshot): ArchitectureViolation[] {
  return lintClickhouseTableOwnershipAt({ root: snapshot.root, catalogue: snapshot.catalogue });
}
