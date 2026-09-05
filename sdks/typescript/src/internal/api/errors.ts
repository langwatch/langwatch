import {
  parseHandledError,
  type CliHandledError,
  type CliHandledErrorReason,
} from "@langwatch/langy-contract/cards/handled-error";

/**
 * A failure the platform NAMED.
 */
export class LangWatchHandledError extends Error {
  /**
   * The discriminant.
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
  /** Whether the platform explicitly marked this failure safe to retry. */
  readonly retryable: boolean;
  /** What the user can DO about it, when the platform sent next steps. */
  readonly suggestions: string[] | undefined;
  /** The docs page that explains the failure, when the platform sent one. */
  readonly docUrl: string | undefined;
  /** The raw response body, verbatim — the escape hatch for anything unmodelled. */
  readonly body: unknown;
  /** What the SDK was doing, e.g. `get dataset "abc"`. */
  readonly operation: string | undefined;

  /**
   * Alias of {@link httpStatus}, and the raw body again under the name the per-service
   * `*ApiError` classes use.
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
    this.retryable = handled.retryable;
    this.suggestions = handled.suggestions;
    this.docUrl = handled.docUrl;
    this.body = body;
    this.operation = operation;
    this.status = handled.httpStatus;
    this.originalError = body;
  }
}

/** Narrows any caught value to a {@link LangWatchHandledError}. */
export const isLangWatchHandledError = (error: unknown): error is LangWatchHandledError =>
  error instanceof LangWatchHandledError ||
  (typeof error === "object" &&
    error !== null &&
    (error as { isLangWatchHandledError?: unknown }).isLangWatchHandledError === true);

/**
 * Read a non-2xx response into a {@link LangWatchHandledError}, or `null` when the
 * platform did NOT name the failure.
 */
export const handledErrorFrom = ({
  operation,
  body,
  status,
  message,
}: {
  /** What was being attempted — `GET /api/v1/traces/{id}`, or a service's phrasing. */
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
