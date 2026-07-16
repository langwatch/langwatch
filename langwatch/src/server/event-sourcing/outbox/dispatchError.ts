import { redactSecretsInText } from "~/server/data-privacy/redaction/secretsRedaction";

/**
 * Why a non-retryable dispatch failed, which decides what the queue does with
 * the job beyond not retrying it:
 *
 *   - `provider_terminal`: the provider answered and rejected us for good (a
 *     revoked webhook, a payload it will never accept). Re-firing can never
 *     succeed, so the queue completes the job out of the queue and the dead
 *     outbox row carries it to an operator.
 *   - `config`: we never got a usable verdict from the provider — the failure
 *     is our own configuration, security, or integrity problem (an invalid
 *     webhook URL, a missing token, a misrouted batch). The broken invariant
 *     must be parked for an operator, never silently dead-lettered.
 *
 * See dev/docs/adr/027-typed-dispatcherror-contract.md.
 */
export type DispatchDisposition = "provider_terminal" | "config";

/**
 * Typed error thrown by outbox dispatch endpoints to signal whether the
 * failure is worth retrying.
 *
 * See dev/docs/adr/027-typed-dispatcherror-contract.md.
 *
 * Dispatch endpoints (alert dispatch, dataset append, etc.) should
 * catch provider/transport errors and re-throw as DispatchError with
 * an explicit `retryable` decision. The drainer interprets:
 *   - retryable: true  → schedule backoff retry (`failed_retryable`)
 *   - retryable: false → mark `dead`, surface to operator
 *
 * Any non-DispatchError thrown from a dispatch endpoint is treated as
 * retryable by default — better to retry an unexpected crash than to
 * silently dead-letter a row whose failure mode we did not classify.
 *
 * `disposition` refines a non-retryable failure. It is absent on a
 * hand-constructed error, which reads as the conservative `config` case: only
 * an explicit `provider_terminal` lets the queue complete a job out of the
 * queue.
 */
export class DispatchError extends Error {
  readonly retryable: boolean;
  readonly cause?: unknown;
  readonly disposition?: DispatchDisposition;

  constructor({
    message,
    retryable,
    cause,
    disposition,
  }: {
    message: string;
    retryable: boolean;
    cause?: unknown;
    disposition?: DispatchDisposition;
  }) {
    super(message);
    this.name = "DispatchError";
    this.retryable = retryable;
    this.cause = cause;
    this.disposition = disposition;
  }
}

/**
 * Whether a failure is a provider's own terminal verdict — the only class of
 * non-retryable failure a queue may complete out of the queue rather than park
 * for an operator.
 */
export function isProviderTerminal(error: unknown): boolean {
  return (
    isDispatchError(error) &&
    !error.retryable &&
    error.disposition === "provider_terminal"
  );
}

export function isDispatchError(error: unknown): error is DispatchError {
  return error instanceof DispatchError;
}

/**
 * Whether an HTTP status warrants a retry, per ADR-027:
 *   - 429 (rate limited) and 5xx (server error) → retry with backoff
 *   - any other 4xx → terminal (revoked webhook, bad request, auth failure)
 */
export function isRetryableHttpStatus(status: number): boolean {
  if (status === 429) return true;
  return status >= 500 && status < 600;
}

/**
 * Best-effort extraction of an HTTP status from the many error shapes the
 * dispatch providers raise (AWS SDK v3, axios/@slack/webhook, SendGrid, fetch).
 * Returns undefined for transport errors (ECONNREFUSED, ETIMEDOUT, …) that
 * carry no HTTP status — those are treated as retryable by the caller.
 *
 * Note `code` is only read when numeric: SendGrid uses a numeric `code` for the
 * status, whereas Node transport errors and @slack/webhook use a string `code`.
 */
export function extractHttpStatus(error: unknown): number | undefined {
  if (typeof error !== "object" || error === null) return undefined;
  const e = error as Record<string, any>;
  const candidates = [
    e.$metadata?.httpStatusCode,
    e.response?.status,
    e.response?.statusCode,
    e.statusCode,
    e.status,
    e.original?.response?.status,
    e.original?.response?.statusCode,
    typeof e.code === "number" ? e.code : undefined,
  ];
  for (const candidate of candidates) {
    if (typeof candidate === "number" && candidate >= 100 && candidate < 600) {
      return candidate;
    }
  }
  return undefined;
}

/**
 * Providers can embed whole response bodies in their error messages; cap the
 * detail so log lines and audit rows stay readable. The cap is inclusive of the
 * ellipsis a truncated message ends with.
 */
export const MAX_CAUSE_MESSAGE_LENGTH = 300;

/**
 * Human-readable summary of the underlying failure — "HTTP 404 — <provider
 * message>" — appended to the DispatchError message. Every sink downstream
 * (outbox dispatcher logs, group-queue audit rows, Sentry titles) serializes
 * only `error.message`, so the detail must live in the message itself for an
 * operator to tell a revoked webhook from a rejected payload.
 *
 * Providers routinely echo the request (headers, auth, whole response bodies)
 * back in the error message, so secrets are scrubbed before the detail reaches
 * any of those sinks. Redaction runs before the cap, so the marker a redaction
 * leaves behind is what gets truncated — never a half-scrubbed credential.
 */
function describeCause(error: unknown, status: number | undefined): string {
  const rawMessage =
    error instanceof Error
      ? error.message
      : typeof error === "string"
        ? error
        : "";
  const { text: redactedMessage } = redactSecretsInText({ text: rawMessage });
  const causeMessage =
    redactedMessage.length > MAX_CAUSE_MESSAGE_LENGTH
      ? redactedMessage.slice(0, MAX_CAUSE_MESSAGE_LENGTH - 1) + "…"
      : redactedMessage;
  return [status === undefined ? "" : `HTTP ${status}`, causeMessage]
    .filter(Boolean)
    .join(" — ");
}

/**
 * Converts a raw dispatch failure into a DispatchError with a retryable
 * decision derived from its HTTP status. An already-typed DispatchError is
 * returned unchanged. Failures with no recognizable status default to
 * retryable — see ADR-027 for why the unknown case is conservative.
 *
 * When the caller knows the failure cannot be retried (e.g. a template
 * render failure where the payload itself is malformed), it can pass
 * `retryable: false` to short-circuit the HTTP-status heuristic and
 * promote the row straight to `dead`.
 *
 * The disposition follows from where the non-retryable verdict came from: only
 * a terminal HTTP status the provider itself returned is `provider_terminal`.
 * A caller-supplied `retryable: false` is a config/integrity judgement we made
 * without the provider, so it stays `config` and parks for an operator.
 */
export function toDispatchError(
  error: unknown,
  {
    message,
    retryable: retryableOverride,
  }: { message: string; retryable?: boolean },
): DispatchError {
  if (isDispatchError(error)) return error;
  const status = extractHttpStatus(error);
  const causeSummary = describeCause(error, status);
  const fullMessage = causeSummary ? `${message}: ${causeSummary}` : message;
  const derivedFromStatus = retryableOverride === undefined;
  const retryable =
    retryableOverride ??
    (status === undefined ? true : isRetryableHttpStatus(status));
  const disposition: DispatchDisposition =
    derivedFromStatus && status !== undefined && !isRetryableHttpStatus(status)
      ? "provider_terminal"
      : "config";
  return new DispatchError({
    message: fullMessage,
    retryable,
    cause: error,
    disposition,
  });
}
