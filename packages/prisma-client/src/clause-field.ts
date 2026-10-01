/**
 * Prisma arguments and WHERE clauses arrive untyped (`GuardParams["args"]`), so
 * every guard narrows a node to a record before it reads a key off it.
 */
export function isClause(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/** One key off an argument or clause of unknown shape; `undefined` off anything else. */
export function clauseField(clause: unknown, key: string): unknown {
  return isClause(clause) ? clause[key] : undefined;
}
