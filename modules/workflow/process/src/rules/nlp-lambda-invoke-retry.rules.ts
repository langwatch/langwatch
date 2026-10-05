/**
 * When a synchronous engine invoke may be sent again: only when the failure proves the
 * function never started, so a retry cannot run the customer's code twice.
 * @see specs/nlp-go/lambda-invoke-response-contract.feature
 */

/** Total attempts for an invoke refused before it started; rides out a cold fleet's burst. */
export const NLP_INVOKE_MAX_ATTEMPTS = 6;

const RETRY_BASE_DELAY_MS = 500;
const RETRY_MAX_DELAY_MS = 8_000;

/** The control plane refusing the invoke outright, before the function ran. */
const INVOKE_REFUSED_ERROR_NAMES = new Set([
  "TooManyRequestsException",
  "ThrottlingException",
  "EC2ThrottledException",
]);

/** Socket errors raised while connecting, so no request bytes reached the service. */
const CONNECT_FAILED_ERROR_CODES = new Set(["ECONNREFUSED", "ENOTFOUND", "EAI_AGAIN"]);

type InvokeFailure = { name?: unknown; code?: unknown; cause?: { code?: unknown } | null } | null;

/** True only for a failure that proves the function never started; anything else is ambiguous. */
export function invokeNeverStarted(error: unknown): boolean {
  const failure = (typeof error === "object" ? error : null) as InvokeFailure;
  const name = failure?.name;
  if (typeof name === "string" && INVOKE_REFUSED_ERROR_NAMES.has(name)) return true;

  const code = failure?.code;
  if (typeof code === "string" && CONNECT_FAILED_ERROR_CODES.has(code)) return true;

  const causeCode = failure?.cause?.code;
  return typeof causeCode === "string" && CONNECT_FAILED_ERROR_CODES.has(causeCode);
}

/** The wait before attempt `attempt + 1`: doubling from 500ms, capped at 8s. */
export function invokeRetryDelayMs(attempt: number): number {
  return Math.min(RETRY_BASE_DELAY_MS * 2 ** (attempt - 1), RETRY_MAX_DELAY_MS);
}
