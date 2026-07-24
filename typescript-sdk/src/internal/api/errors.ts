import {
  parseHandledError,
  type CliHandledError,
  type CliHandledErrorReason,
} from "@langwatch/langy/cards/handled-error";

/**
 * A failure the platform NAMED.
 *
 * The API does not merely fail — when it declines a request it says precisely
 * why, as a `HandledError` with a serialisable `kind` (`dataset_not_found`,
 * `validation_error`), the HTTP status it answers with, and a `meta` bag of the
 * context that makes the failure actionable. Until now the SDK collapsed all of
 * that into an English sentence on a generic error, so a caller could read the
 * failure but never react to it: a 404 "dataset not found" — a fact you can
 * offer to fix — was indistinguishable from a 500.
 *
 * This is that structure, kept. Narrow with {@link isLangWatchHandledError} (or
 * `instanceof`) and switch on `code`; `body` is the escape hatch to whatever the
 * platform sent that this class did not model.
 *
 * ```ts
 * try {
 *   await langwatch.datasets.get("nope");
 * } catch (error) {
 *   if (isLangWatchHandledError(error) && error.code === "dataset_not_found") {
 *     // Actionable: we know WHAT was not found, and can offer the list.
 *     console.error(error.meta.id, error.traceId);
 *   }
 *   throw error;
 * }
 * ```
 *
 * ONLY raised for a failure the platform named. An infrastructure failure — a
 * 5xx, a dead socket, a proxy's HTML error page — still raises the generic
 * service error it always did, because presenting one of those as a domain
 * error would blame the user for our outage.
 */
export class LangWatchHandledError extends Error {
  /**
   * The discriminant. A boolean brand rather than `instanceof` alone because a
   * bundled CLI and a consumer's `node_modules` copy of the SDK can hold two
   * different copies of this class, and `instanceof` is false across that seam —
   * the same reason the platform's own error handler tests for `code` rather
   * than class identity.
   */
  readonly isLangWatchHandledError = true as const;

  /** The platform's serialisable discriminant, e.g. `dataset_not_found`. */
  readonly code: string;
  /**
   * @deprecated Back-compat alias of `code`, kept while the platform's
   * `DomainError` → `HandledError` rename rolls out. Read `code` in new code.
   */
  readonly kind: string;
  /** The status the platform answered with. */
  readonly httpStatus: number;
  /** The context the platform attached: ids, field errors — whatever makes it actionable. */
  readonly meta: Record<string, unknown>;
  /** The OTel trace to quote at support. Absent unless the route sent one. */
  readonly traceId: string | undefined;
  /** A clickable link to that trace, when the route sent one. */
  readonly traceUrl: string | undefined;
  /** A clickable link to the logs for that trace, when the route sent one. */
  readonly logsUrl: string | undefined;
  /** The failure behind the failure, when the route sent the chain. */
  readonly reasons: CliHandledErrorReason[] | undefined;
  /** What the user can DO about it, when the platform sent next steps. */
  readonly suggestions: string[] | undefined;
  /** The docs page that explains the failure, when the platform sent one. */
  readonly docUrl: string | undefined;
  /** The raw response body, verbatim — the escape hatch for anything unmodelled. */
  readonly body: unknown;
  /** What the SDK was doing, e.g. `get dataset "abc"`. */
  readonly operation: string | undefined;

  /**
   * Alias of {@link httpStatus}, and the raw body again under the name the
   * per-service `*ApiError` classes use.
   *
   * Not redundancy for its own sake: this class is thrown from the SAME code
   * path that used to throw `TracesApiError` & friends, so anything that reads
   * `.status` or `.originalError` off a caught SDK error — including the CLI's
   * own telemetry reader — keeps working unchanged.
   */
  readonly status: number;
  readonly originalError: unknown;

  constructor({
    handled,
    body,
    operation,
    message,
  }: {
    handled: CliHandledError;
    body: unknown;
    operation?: string;
    message: string;
  }) {
    super(message);
    this.name = "LangWatchHandledError";
    this.code = handled.code;
    this.kind = handled.code;
    this.httpStatus = handled.httpStatus;
    this.meta = handled.meta;
    this.traceId = handled.traceId;
    this.traceUrl = handled.traceUrl;
    this.logsUrl = handled.logsUrl;
    this.reasons = handled.reasons;
    this.suggestions = handled.suggestions;
    this.docUrl = handled.docUrl;
    this.body = body;
    this.operation = operation;
    this.status = handled.httpStatus;
    this.originalError = body;
  }
}

/** Narrows any caught value to a {@link LangWatchHandledError}. */
export const isLangWatchHandledError = (
  error: unknown,
): error is LangWatchHandledError =>
  error instanceof LangWatchHandledError ||
  (typeof error === "object" &&
    error !== null &&
    (error as { isLangWatchHandledError?: unknown }).isLangWatchHandledError ===
      true);

/**
 * Read a non-2xx response into a {@link LangWatchHandledError}, or `null` when the
 * platform did NOT name the failure.
 *
 * `null` is the important half of the contract: it means "this was not a domain
 * error", and every caller answers it by throwing exactly the generic error it
 * threw before. A malformed body, an HTML error page from a proxy, a bare 500 —
 * all take the old path untouched. This is strictly additive.
 */
export const handledErrorFrom = ({
  operation,
  body,
  status,
  message,
}: {
  /** What was being attempted — `GET /api/traces/{id}`, or a service's phrasing. */
  operation?: string;
  /** The parsed error body, as the HTTP client handed it back. */
  body: unknown;
  /** The status the response carried, when it is known. */
  status?: number;
  /**
   * The message the generic path WOULD have produced. Passed by callers that
   * already built one (so nothing regresses); omitted by the transport, which
   * has no operation worth prefixing and lets the platform's own sentence stand.
   */
  message?: string;
}): LangWatchHandledError | null => {
  const handled = parseHandledError({ status: status ?? 0, body });
  if (!handled.isHandled) return null;

  return new LangWatchHandledError({
    handled,
    body,
    operation,
    // The platform wrote its message for a user to read. Use it as-is unless a
    // caller hands us the sentence it had already composed.
    message: message ?? handled.message,
  });
};

export class LangWatchApiError extends Error {
  public readonly httpStatus: number;
  public readonly httpStatusText: string;
  public apiError: string | undefined;
  public body: unknown;

  constructor(message: string, response: Response) {
    super(message);
    this.httpStatus = response.status;
    this.httpStatusText = response.statusText;
  }

  async safeParseBody(response: Response): Promise<void> {
    try {
      if (response.headers.get("Content-Type")?.includes("application/json")) {
        const json = await response.json();

        this.body = json;

        if (json.error && typeof json.error === "string") {
          this.apiError = json.error;
        }

        return;
      }

      this.body = await response.text();
    } catch {
      this.body = null;
    }
  }
}
