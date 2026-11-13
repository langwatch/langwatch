/**
 * Replays the goose ClickHouse migrations into the tables they leave behind, with each table's
 * columns, engine and sorting key, so the app reader's guard tests read the schema, not a list.
 * @see specs/clickhouse/app-reader-row-policies.feature
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const CLICKHOUSE_MIGRATIONS_DIRECTORY = fileURLToPath(
  new URL("../../../../../../../packages/clickhouse-migrations/migrations/", import.meta.url),
);

export interface MigratedTable {
  readonly name: string;
  readonly columns: readonly string[];
  /** The engine family, `Replicated` and arguments stripped, e.g. `ReplacingMergeTree`. */
  readonly engine: string;
  readonly sortingKey: readonly string[];
  /** The migration that last created or reshaped it. */
  readonly migration: string;
}

const NAME = String.raw`(?:\x60?[A-Za-z_]\w*\x60?\.)?\x60?([A-Za-z_]\w*)\x60?`;
const CREATE_TABLE = new RegExp(
  String.raw`^CREATE\s+TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?${NAME}\s*(?:ON\s+CLUSTER\s+\S+\s*)?`,
  "i",
);
const CLONE = new RegExp(String.raw`^AS\s+${NAME}`, "i");
const CREATE_VIEW = new RegExp(
  String.raw`^CREATE\s+(?:OR\s+REPLACE\s+)?(?:MATERIALIZED\s+)?VIEW\s+(?:IF\s+NOT\s+EXISTS\s+)?${NAME}([\s\S]*)$`,
  "i",
);
const DROP = new RegExp(String.raw`^DROP\s+(?:TABLE|VIEW)\s+(?:IF\s+EXISTS\s+)?${NAME}`, "i");
const EXCHANGE = new RegExp(String.raw`^EXCHANGE\s+TABLES\s+${NAME}\s+AND\s+${NAME}`, "i");
const RENAME = new RegExp(String.raw`^RENAME\s+TABLE\s+${NAME}\s+TO\s+${NAME}`, "i");
const ALTER = new RegExp(String.raw`^ALTER\s+TABLE\s+${NAME}([\s\S]*)$`, "i");
const ADD_COLUMN = /\bADD\s+COLUMN\s+(?:IF\s+NOT\s+EXISTS\s+)?`?([A-Za-z_]\w*)/gi;
const DROP_COLUMN = /\bDROP\s+COLUMN\s+(?:IF\s+EXISTS\s+)?`?([A-Za-z_]\w*)/gi;
const MODIFY_ORDER_BY = /\bMODIFY\s+ORDER\s+BY\s+([\s\S]*)$/i;
const ENGINE = /\bENGINE\s*=\s*(?:Replicated)?([A-Za-z]+)/i;
const ORDER_BY = /\bORDER\s+BY\s+/i;
const CLAUSE_END = /\s(?:PARTITION\s+BY|PRIMARY\s+KEY|SAMPLE\s+BY|TTL|SETTINGS|AS\s+SELECT)\b/i;

/** The `+goose Up` half, comments removed and goose ENVSUB defaults filled in. */
function upStatements(text: string): string[] {
  const down = text.indexOf("+goose Down");
  return (down < 0 ? text : text.slice(0, down))
    .replace(/--[^\n]*/g, "")
    .replace(/\$\{[A-Z0-9_]+:-([^}]*)\}/g, "$1")
    .replace(/\$\{[A-Z0-9_]+\}\.?/g, "")
    .split(";")
    .map((statement) => statement.trim())
    .filter(Boolean);
}

/** Splits on commas outside parentheses and quotes. */
function topLevel(list: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let quoted = false;
  let current = "";
  for (const char of list) {
    if (char === "'") quoted = !quoted;
    if (!quoted && char === "(") depth += 1;
    if (!quoted && char === ")") depth -= 1;
    if (!quoted && depth === 0 && char === ",") {
      parts.push(current.trim());
      current = "";
    } else current += char;
  }
  if (current.trim()) parts.push(current.trim());
  return parts;
}

/** The text inside the parentheses opening at `start`, and the index after the closing one. */
function balanced(text: string, start: number): { inner: string; end: number } {
  let depth = 0;
  for (let index = start; index < text.length; index += 1) {
    if (text[index] === "(") depth += 1;
    if (text[index] === ")") depth -= 1;
    if (depth === 0) return { inner: text.slice(start + 1, index), end: index + 1 };
  }
  throw new Error(`unbalanced parentheses in migration statement: ${text.slice(start, 80)}`);
}

function sortingKeyOf(clauses: string): string[] {
  const match = ORDER_BY.exec(clauses);
  if (!match) return [];
  const rest = clauses.slice(match.index + match[0].length);
  if (rest.startsWith("(")) return topLevel(balanced(rest, 0).inner);
  const end = CLAUSE_END.exec(rest);
  return topLevel(end ? rest.slice(0, end.index) : rest);
}

function columnsOf(body: string): string[] {
  return topLevel(body)
    .map((definition) => definition.replace(/^`/, "").split(/[\s`]/)[0] ?? "")
    .filter((name) => name && !/^(INDEX|PROJECTION|CONSTRAINT)$/i.test(name));
}

function created(statement: string, migration: string): MigratedTable | undefined {
  const head = CREATE_TABLE.exec(statement);
  if (!head?.[1]) return undefined;
  const rest = statement.slice(head[0].length);
  if (!rest.startsWith("(")) return undefined;
  const { inner, end } = balanced(rest, 0);
  const clauses = rest.slice(end);
  return {
    name: head[1],
    columns: columnsOf(inner),
    engine: ENGINE.exec(clauses)?.[1] ?? "",
    sortingKey: sortingKeyOf(clauses),
    migration,
  };
}

function altered(table: MigratedTable, actions: string, migration: string): MigratedTable {
  const dropped = new Set([...actions.matchAll(DROP_COLUMN)].map((match) => match[1]));
  const added = [...actions.matchAll(ADD_COLUMN)].flatMap((match) => (match[1] ? [match[1]] : []));
  const orderBy = MODIFY_ORDER_BY.exec(actions);
  return {
    ...table,
    columns: [...table.columns.filter((column) => !dropped.has(column)), ...added],
    sortingKey: orderBy ? sortingKeyOf(`ORDER BY ${orderBy[1]}`) : table.sortingKey,
    migration,
  };
}

/** A `CREATE TABLE` this replay cannot read fails loudly, never drops out of the guard. */
function createdOrCloned(
  live: ReadonlyMap<string, MigratedTable>,
  statement: string,
  migration: string,
): MigratedTable | undefined {
  const head = CREATE_TABLE.exec(statement);
  if (!head?.[1]) return undefined;
  const table = created(statement, migration);
  if (table) return table;
  const clone = CLONE.exec(statement.slice(head[0].length));
  const source = clone?.[1] ? live.get(clone[1]) : undefined;
  if (source) return { ...source, name: head[1], migration };
  throw new Error(`${migration}: cannot read CREATE TABLE ${head[1]}; teach the replay its shape`);
}

/** Applies one statement to the live table map; anything but DDL leaves it as it was. */
function apply(live: Map<string, MigratedTable>, statement: string, migration: string): void {
  const table = createdOrCloned(live, statement, migration);
  if (table) return void live.set(table.name, table);
  const view = CREATE_VIEW.exec(statement);
  // A view with storage of its own (no `TO`) would hold rows; none exists, so refuse one.
  if (view?.[1] && !/^\s*TO\s/i.test(view[2] ?? "")) {
    throw new Error(`${migration}: view ${view[1]} has its own storage; classify it`);
  }
  const drop = DROP.exec(statement);
  if (drop?.[1]) return void live.delete(drop[1]);
  const exchange = EXCHANGE.exec(statement);
  const [left, right] = [exchange?.[1], exchange?.[2]];
  if (left && right) {
    const [a, b] = [live.get(left), live.get(right)];
    if (b) live.set(left, { ...b, name: left, migration });
    if (a) live.set(right, { ...a, name: right, migration });
    return;
  }
  const rename = RENAME.exec(statement);
  if (rename?.[1] && rename[2]) {
    const moved = live.get(rename[1]);
    live.delete(rename[1]);
    if (moved) live.set(rename[2], { ...moved, name: rename[2], migration });
    return;
  }
  const alter = ALTER.exec(statement);
  const existing = alter?.[1] ? live.get(alter[1]) : undefined;
  if (existing && alter?.[2]) live.set(existing.name, altered(existing, alter[2], migration));
}

/** Every table the migrations leave behind, keyed by name. */
export function migratedTables(
  directory = CLICKHOUSE_MIGRATIONS_DIRECTORY,
): Map<string, MigratedTable> {
  const live = new Map<string, MigratedTable>();
  for (const file of readdirSync(directory)
    .filter((name) => name.endsWith(".sql"))
    .toSorted()) {
    for (const statement of upStatements(readFileSync(join(directory, file), "utf8"))) {
      apply(live, statement, file);
    }
  }
  return live;
}
