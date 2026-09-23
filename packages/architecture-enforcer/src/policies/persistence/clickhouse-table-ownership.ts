import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

import ts from "typescript";

import type { ArchitectureViolation, FeatureCatalogueEntry } from "../../types.ts";
import { getAnchor } from "../../workspace/anchors.ts";
import { listFiles } from "../../workspace/layout.ts";
import { sourceFile, sourceText } from "../../workspace/module-graph.ts";
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
const READING_VERBS = new Set(["from", "join"]);

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
  if (!/from|join|into|table/i.test(sourceText({ file }))) return;

  const source = sourceFile({ file });
  const reader: Reader = { source, module, tables, constants: literalConstants(source), found };

  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteralLike(node)) readSql(reader, node);

    if (ts.isTemplateExpression(node)) readSql(reader, node);

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

    const files = listFiles({
      directory: scan.directory,
      accept: (file) => SOURCE_FILE.test(file) && !TEST_FILE.test(file),
    });

    for (const file of [...files].toSorted())
      readFile({ file, module: scan.module, tables, found });
  }

  return found.toSorted(
    (left, right) => left.file.localeCompare(right.file) || left.line - right.line,
  );
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

  for (const [table, migration] of [...tables].toSorted(([a], [b]) => a.localeCompare(b))) {
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

  return collectFindings(collectAccess(root, catalogue, tables), tables, root);
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

/** The registry entry: the same check, reading the catalogue off a snapshot. */
export function lintClickhouseTableOwnership(snapshot: WorkspaceSnapshot): ArchitectureViolation[] {
  return lintClickhouseTableOwnershipAt({ root: snapshot.root, catalogue: snapshot.catalogue });
}
