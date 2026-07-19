import {
  parseDomainError,
  type CliDomainError,
  type CliDomainErrorReason,
} from "@langwatch/cli-cards/domain-error";

/**
 * A failure the platform NAMED.
 *
 * The API does not merely fail — when it declines a request it says precisely
 * why, as a `DomainError` with a serialisable `kind` (`dataset_not_found`,
 * `validation_error`), the HTTP status it answers with, and a `meta` bag of the
 * context that makes the failure actionable. Until now the SDK collapsed all of
 * that into an English sentence on a generic error, so a caller could read the
 * failure but never react to it: a 404 "dataset not found" — a fact you can
 * offer to fix — was indistinguishable from a 500.
 *
 * This is that structure, kept. Narrow with {@link isLangWatchDomainError} (or
 * `instanceof`) and switch on `kind`; `body` is the escape hatch to whatever the
 * platform sent that this class did not model.
 *
 * ```ts
 * try {
 *   await langwatch.datasets.get("nope");
 * } catch (error) {
 *   if (isLangWatchDomainError(error) && error.kind === "dataset_not_found") {
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
export class LangWatchDomainError extends Error {
  /**
   * The discriminant. A boolean brand rather than `instanceof` alone because a
   * bundled CLI and a consumer's `node_modules` copy of the SDK can hold two
   * different copies of this class, and `instanceof` is false across that seam —
   * the same reason the platform's own error handler tests for `kind` rather
   * than class identity.
   */
  readonly isLangWatchDomainError = true as const;

  /** The platform's serialisable discriminant, e.g. `dataset_not_found`. */
  readonly kind: string;
  /** The status the platform answered with. */
  readonly httpStatus: number;
  /** The context the platform attached: ids, field errors — whatever makes it actionable. */
  readonly meta: Record<string, unknown>;
  /** The OTel trace to quote at support. Absent unless the route sent one. */
  readonly traceId: string | undefined;
  /** The failure behind the failure, when the route sent the chain. */
  readonly reasons: CliDomainErrorReason[] | undefined;
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
    domain,
    body,
    operation,
    message,
  }: {
    domain: CliDomainError;
    body: unknown;
    operation?: string;
    message: string;
  }) {
    super(message);
    this.name = "LangWatchDomainError";
    this.kind = domain.kind;
    this.httpStatus = domain.httpStatus;
    this.meta = domain.meta;
    this.traceId = domain.traceId;
    this.reasons = domain.reasons;
    this.body = body;
    this.operation = operation;
    this.status = domain.httpStatus;
    this.originalError = body;
  }
}

/** Narrows any caught value to a {@link LangWatchDomainError}. */
export const isLangWatchDomainError = (
  error: unknown,
): error is LangWatchDomainError =>
  error instanceof LangWatchDomainError ||
  (typeof error === "object" &&
    error !== null &&
    (error as { isLangWatchDomainError?: unknown }).isLangWatchDomainError ===
      true);

/**
 * Read a non-2xx response into a {@link LangWatchDomainError}, or `null` when the
 * platform did NOT name the failure.
 *
 * `null` is the important half of the contract: it means "this was not a domain
 * error", and every caller answers it by throwing exactly the generic error it
 * threw before. A malformed body, an HTML error page from a proxy, a bare 500 —
 * all take the old path untouched. This is strictly additive.
 */
export const domainErrorFrom = ({
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
}): LangWatchDomainError | null => {
  const domain = parseDomainError({ status: status ?? 0, body });
  if (!domain.isDomain) return null;

  return new LangWatchDomainError({
    domain,
    body,
    operation,
    // The platform wrote its message for a user to read. Use it as-is unless a
    // caller hands us the sentence it had already composed.
    message: message ?? domain.message,
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
