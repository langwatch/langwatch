import {
  LangWatchQLReservedParameterSuppliedError,
  LWQL_LIST_PARAMETERS,
} from "@langwatch/analytics-contract";

import { clickHouseSqlParser, type SqlAstNode } from "./langwatch-ql-parser.rules.ts";
import { METADATA_FIELDS } from "./langwatch-ql-validation-shape.rules.ts";

const MENTIONS_RESERVED_NAME = /dashboard_context_(?:sources|projects)/i;

const isReservedList = (name: unknown): name is string =>
  typeof name === "string" &&
  (LWQL_LIST_PARAMETERS as readonly string[]).includes(name.toLowerCase());

/** The reserved names a node assigns by its own fields: an alias, a `WITH` name or a `SET`. */
function assignedBy(node: SqlAstNode): string[] {
  const names: unknown[] = [node.alias];
  if (node.type === "WithElement") names.push(node.name);
  if (node.type === "Settings" && typeof node.changes === "object" && node.changes !== null) {
    names.push(...Object.keys(node.changes).map((key) => key.replace(/^param_/i, "")));
  }

  return names.filter(isReservedList).map((name) => name.toLowerCase());
}

/** The reserved list names a parsed tree gives a value to. */
function collectAssigned(value: unknown, found: Set<string>): void {
  if (Array.isArray(value)) {
    for (const item of value) collectAssigned(item, found);
    return;
  }
  if (typeof value !== "object" || value === null) return;
  const node = value as SqlAstNode;
  for (const name of assignedBy(node)) found.add(name);
  for (const [field, child] of Object.entries(node)) {
    if (!METADATA_FIELDS.includes(field)) collectAssigned(child, found);
  }
}

/**
 * Refuses a statement that gives a reserved list name a value of its own: `SET param_…`, an
 * alias, or a `WITH` name. Declaring the typed placeholder and reading it stays allowed.
 * @throws {LangWatchQLReservedParameterSuppliedError} naming the reserved names assigned.
 */
export function assertNoReservedNameAssigned(sql: string): void {
  if (!MENTIONS_RESERVED_NAME.test(sql)) return;
  const parsed = clickHouseSqlParser.parse(sql);
  // A statement that does not parse is the validator's to refuse.
  if (!parsed.ok) return;
  const assigned = new Set<string>();
  collectAssigned(parsed.statements, assigned);
  if (assigned.size > 0)
    throw new LangWatchQLReservedParameterSuppliedError([...assigned].toSorted());
}
