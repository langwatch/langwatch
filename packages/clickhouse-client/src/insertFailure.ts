/**
 * Marks an error an insert statement threw, so a caller can tell a refused write from a refused
 * read. A registered symbol, so a package that may not import this client reads it by name.
 */
export const INSERT_FAILURE_MARK = Symbol.for("langwatch.clickhouse.insert-failure");

/** Records that `error` came from an insert statement; non-objects carry no mark. */
export function markInsertFailure(error: unknown): void {
  if (typeof error !== "object" || error === null) return;
  Reflect.defineProperty(error, INSERT_FAILURE_MARK, { value: true, configurable: true });
}

/** Whether `error` is exactly an error an insert statement threw. */
export function isInsertFailure(error: unknown): boolean {
  if (typeof error !== "object" || error === null) return false;
  return Reflect.get(error, INSERT_FAILURE_MARK) === true;
}
