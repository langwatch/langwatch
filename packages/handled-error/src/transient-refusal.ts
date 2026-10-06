import type { AppErrorCode } from "./app-codes.ts";
import type { HandledError } from "./handled-error.ts";

/**
 * The 503 refusals that keep their body through the 5xx mask: the caller waits and retries,
 * and the code says why (rulings 2026-10-06, round 9, CH-1). Any other undeclared 5xx stays masked.
 */
export const TRANSIENT_REFUSAL_CODES = [
  "clickhouse_overloaded",
  "service_unavailable",
] as const satisfies readonly AppErrorCode[];

const TRANSIENT_REFUSAL_STATUS = 503;

const TRANSIENT_CODES: ReadonlySet<string> = new Set(TRANSIENT_REFUSAL_CODES);

/** True for a handled error answering one of {@link TRANSIENT_REFUSAL_CODES} at 503. */
export function isTransientRefusal(error: Pick<HandledError, "code" | "httpStatus">): boolean {
  return error.httpStatus === TRANSIENT_REFUSAL_STATUS && TRANSIENT_CODES.has(error.code);
}
