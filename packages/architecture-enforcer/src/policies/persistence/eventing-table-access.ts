import { existsSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";

import ts from "typescript";

import type { ArchitectureViolation, FeatureCatalogueEntry } from "../../types.ts";
import { listFiles } from "../../workspace/layout.ts";
import { sourceFile, sourceText } from "../../workspace/module-graph.ts";
import type { WorkspaceSnapshot } from "../../workspace/snapshot.ts";
import { prismaModelNames } from "./prisma-table-ownership.ts";

/**
 * The event tables are eventing's: only packages/eventing reads or writes the
 * event log and the process-manager tables. See dev/docs/ARCHITECTURE.md §7.
 */

const POLICY = "eventing-table-access";
const EVENT_LOG = "event_log";
const PROCESS_MANAGER_MODEL = /^ProcessManager/;
const EVENT_STORE_CALLS = new Set(["storeEvents", "getEventStore"]);
const TEST_FILE = /(?:__tests__|__fixtures__|\/fixtures\/|\.(?:test|spec)\.)/;
const SOURCE_FILE = /\.[cm]?tsx?$/;
const SQL_VERB =
  "(?:FROM|JOIN|INSERT\\s+INTO|UPDATE|DELETE\\s+FROM|ALTER\\s+TABLE|TRUNCATE\\s+TABLE|OPTIMIZE\\s+TABLE)";
const ALLOWED =
  "Send the owning pipeline a command, or call eventing's own surface; never the table. See dev/docs/ARCHITECTURE.md §7.";

/** How a file reaches an event table: raw SQL, a Prisma delegate, a literal name, or the store. */
export type EventingAccessKind = "sql" | "delegate" | "named" | "event-store";

export type EventingAccess = {
  owner: string;
  table: string;
  kind: EventingAccessKind;
  file: string;
  line: number;
};

type ScanRoot = { owner: string; directory: string };
type Reader = {
  source: ts.SourceFile;
  owner: string;
  tables: ReadonlySet<string>;
  delegates: ReadonlyMap<string, string>;
  sql: RegExp;
  found: EventingAccess[];
};

/** `event_log` and every Prisma model eventing's process store keeps. */
export function eventingTables(root: string): string[] {
  const models = [...prismaModelNames({ root, policy: POLICY }).keys()];

  return [EVENT_LOG, ...models.filter((model) => PROCESS_MANAGER_MODEL.test(model)).toSorted()];
}

function scanRoots({
  root,
  catalogue,
}: {
  root: string;
  catalogue: readonly FeatureCatalogueEntry[];
}): ScanRoot[] {
  const modules = catalogue.map((entry) => ({
    owner: entry.id,
    directory: join(root, entry.root),
  }));
  const appsRoot = join(root, "apps");
  const apps = existsSync(appsRoot)
    ? readdirSync(appsRoot, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => ({
          owner: `app:${entry.name}`,
          directory: join(appsRoot, entry.name, "src"),
        }))
    : [];

  return [...modules, ...apps].filter((scan) => existsSync(scan.directory));
}

function record({
  reader,
  node,
  table,
  kind,
}: {
  reader: Reader;
  node: ts.Node;
  table: string;
  kind: EventingAccessKind;
}): void {
  const line = reader.source.getLineAndCharacterOfPosition(node.getStart(reader.source)).line + 1;
  reader.found.push({ owner: reader.owner, table, kind, file: reader.source.fileName, line });
}

function readLiteral(reader: Reader, node: ts.Node): void {
  const text = ts.isStringLiteralLike(node) ? node.text : node.getText(reader.source);
  if (reader.tables.has(text)) {
    record({ reader, node, table: text, kind: "named" });
    return;
  }

  for (const match of text.matchAll(reader.sql))
    record({ reader, node, table: match[1] ?? "", kind: "sql" });
}

function propertyName(name: ts.PropertyName): string | undefined {
  return ts.isIdentifier(name) || ts.isStringLiteral(name) ? name.text : void 0;
}

function calledMethod(node: ts.Node): string | undefined {
  const call = ts.isCallExpression(node) ? node.expression : void 0;

  return call && ts.isPropertyAccessExpression(call) ? call.name.text : void 0;
}

function readNode(reader: Reader, node: ts.Node): void {
  if (ts.isStringLiteralLike(node) || ts.isTemplateExpression(node)) readLiteral(reader, node);

  const named = ts.isPropertyAssignment(node) ? propertyName(node.name) : void 0;
  if (named && reader.tables.has(named)) record({ reader, node, table: named, kind: "named" });

  const delegate = ts.isPropertyAccessExpression(node)
    ? reader.delegates.get(node.name.text)
    : void 0;
  if (delegate) record({ reader, node, table: delegate, kind: "delegate" });

  const method = calledMethod(node);
  if (method && EVENT_STORE_CALLS.has(method))
    record({ reader, node, table: method, kind: "event-store" });
}

function readFile({
  file,
  owner,
  shape,
  found,
}: {
  file: string;
  owner: string;
  shape: Pick<Reader, "tables" | "delegates" | "sql">;
  found: EventingAccess[];
}): void {
  const text = sourceText({ file });
  const names = [...shape.tables, ...shape.delegates.keys(), ...EVENT_STORE_CALLS];
  if (!names.some((name) => text.includes(name))) return;

  const source = sourceFile({ file });
  const reader: Reader = { source, owner, found, ...shape };
  const visit = (node: ts.Node): void => {
    readNode(reader, node);
    ts.forEachChild(node, visit);
  };
  visit(source);
}

function escape(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Every raw access module or application code makes to an event table, in file order. */
export function collectEventingTableAccess({
  root,
  catalogue,
}: {
  root: string;
  catalogue: readonly FeatureCatalogueEntry[];
}): EventingAccess[] {
  const tables = eventingTables(root);
  const alternatives = tables.map(escape).join("|");
  const shape = {
    tables: new Set(tables),
    delegates: new Map(
      tables
        .filter((table) => table !== EVENT_LOG)
        .map((model): [string, string] => [
          `${model.charAt(0).toLowerCase()}${model.slice(1)}`,
          model,
        ]),
    ),
    sql: new RegExp(`\\b${SQL_VERB}\\s+(?:\\$\\{[^}]*\\}\\.)?[\`"]?(${alternatives})\\b`, "g"),
  };
  const found: EventingAccess[] = [];

  for (const scan of scanRoots({ root, catalogue })) {
    const files = listFiles({
      directory: scan.directory,
      accept: (file) => SOURCE_FILE.test(file) && !TEST_FILE.test(file),
    });

    for (const file of [...files].toSorted()) readFile({ file, owner: scan.owner, shape, found });
  }

  return found;
}

/** A baseline-free key for one access site: owner, file, kind and table, no line. */
export function eventingAccessKey({
  root,
  access,
}: {
  root: string;
  access: EventingAccess;
}): string {
  return `${access.owner}|${relative(root, access.file)}|${access.kind}:${access.table}`;
}

function describeAccess(access: EventingAccess): string {
  if (access.kind === "event-store")
    return `${access.owner} calls ${access.table}(), appending to the event log past its pipeline.`;
  if (access.kind === "delegate")
    return `${access.owner} reaches ${access.table} through its Prisma delegate.`;
  if (access.kind === "sql") return `${access.owner} runs SQL over ${access.table}.`;

  return `${access.owner} names ${access.table}, an event table.`;
}

/** Any raw access to an event table outside packages/eventing is a violation. */
export function lintEventingTableAccess(snapshot: WorkspaceSnapshot): ArchitectureViolation[] {
  return collectEventingTableAccess({ root: snapshot.root, catalogue: snapshot.catalogue }).map(
    (access) => ({
      policy: POLICY,
      file: access.file,
      line: access.line,
      message: `${describeAccess(access)} Only packages/eventing touches the event tables.`,
      allowed: ALLOWED,
    }),
  );
}
