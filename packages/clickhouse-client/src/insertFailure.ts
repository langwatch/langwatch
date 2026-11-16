/** Errors an insert statement threw, so a caller can tell a refused write from a refused read. */
const insertFailures = new WeakSet<object>();

/** Records that `error` came from an insert statement; non-objects carry no mark. */
export function markInsertFailure(error: unknown): void {
  if (typeof error === "object" && error !== null) insertFailures.add(error);
}

/** Whether `error` is exactly an error an insert statement threw. */
export function isInsertFailure(error: unknown): boolean {
  return typeof error === "object" && error !== null && insertFailures.has(error);
}
