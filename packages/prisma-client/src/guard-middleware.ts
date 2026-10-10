/**
 * Calling convention for tenancy and mass-delete guards. Adapted to Prisma 7's query extensions
 * while keeping the (params, next) shape guards expect.
 */
export interface GuardParams {
  /** Undefined for raw / model-less operations, exactly as under `$use`. */
  model?: string;
  /** The operation name: `findMany`, `create`, `queryRaw`, `executeRaw`, … */
  action: string;
  args: unknown;
}

export type GuardNext = (params: GuardParams) => Promise<unknown>;

export type GuardMiddleware = (params: GuardParams, next: GuardNext) => Promise<unknown>;

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
