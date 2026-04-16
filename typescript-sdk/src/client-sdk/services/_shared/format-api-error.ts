/**
 * Extracts the most informative, user-facing message from an API error body.
 *
 * Errors from the LangWatch API follow the shape `{ error: string, message?: string }`
 * per `errorSchema` in the server. In production the middleware may return a
 * generic `{ error: "Internal server error", message: "Internal server error" }`
 * which is useless to a user — this helper at least falls back to stringifying
 * the raw body so no diagnostic information is lost.
 *
 * Priority (first non-generic, non-empty wins):
 *   1. `body.message` (descriptive sentence from the server)
 *   2. `body.error`   (error kind — "NotFoundError", "Conflict", …)
 *   3. Any other string fields on the body object (e.g. `detail`, `reason`)
 *   4. JSON stringification of the entire body
 *   5. `Error#message` if the input is a thrown Error
 *   6. A status-code-derived fallback, if available
 */
const GENERIC_MESSAGES = new Set([
  "",
  "internal server error",
  "unknown error",
  "unknown error occurred",
]);

function isGeneric(s: string): boolean {
  return GENERIC_MESSAGES.has(s.trim().toLowerCase());
}

function firstMeaningful(...candidates: Array<unknown>): string | undefined {
  for (const c of candidates) {
    if (typeof c === "string" && !isGeneric(c)) return c;
  }
  return undefined;
}

function collectAllOwnPropertyNames(value: unknown, seen = new Set<unknown>()): string[] {
  if (!value || typeof value !== "object" || seen.has(value)) return [];
  seen.add(value);
  const names = new Set<string>();
  for (const name of Object.getOwnPropertyNames(value)) {
    names.add(name);
    try {
      const child = (value as Record<string, unknown>)[name];
      for (const nested of collectAllOwnPropertyNames(child, seen)) {
        names.add(nested);
      }
    } catch {
      // Ignore getter side effects.
    }
  }
  return Array.from(names);
}

function stringifyBody(body: unknown): string {
  try {
    // Use all own property names (including non-enumerable ones, common on
    // native Error instances and fetch errors) so we preserve every field the
    // server sent, at any nesting depth.
    if (body && typeof body === "object") {
      return JSON.stringify(body, collectAllOwnPropertyNames(body));
    }
    return JSON.stringify(body);
  } catch {
    return String(body);
  }
}

export interface FormatApiErrorOptions {
  /**
   * HTTP status code from the response, when known. Used as part of the
   * fallback output so that the user has at least some actionable signal.
   */
  status?: number;
}

export function formatApiErrorMessage(
  error: unknown,
  options: FormatApiErrorOptions = {},
): string {
  if (error == null) {
    return options.status
      ? `Request failed with status ${options.status}`
      : "Unknown error occurred";
  }

  if (typeof error === "string") {
    return isGeneric(error) && options.status
      ? `${error} (status ${options.status})`
      : error;
  }

  if (error instanceof Error) {
    return error.message || "Unknown error occurred";
  }

  if (typeof error === "object") {
    const body = error as Record<string, unknown>;

    // Most specific fields first.
    const fromMessage = typeof body.message === "string" ? body.message : undefined;
    const fromError = typeof body.error === "string" ? body.error : undefined;
    const fromDetail = typeof body.detail === "string" ? body.detail : undefined;
    const fromReason = typeof body.reason === "string" ? body.reason : undefined;

    // If `body.error` is itself a nested object (some tRPC-style shapes, or
    // a native Error instance that got passed through), drill into it.
    if (body.error && typeof body.error === "object") {
      const nested = body.error as Record<string, unknown>;

      // Native Error instances have .message on the prototype — handle them
      // specifically to avoid dropping back to raw JSON.
      if (body.error instanceof Error && body.error.message) {
        return body.error.message;
      }

      const fromNestedMsg = typeof nested.message === "string" ? nested.message : undefined;
      const fromNestedErr = typeof nested.error === "string" ? nested.error : undefined;
      const nestedMeaningful = firstMeaningful(fromNestedMsg, fromNestedErr);
      if (nestedMeaningful) {
        const kind = fromError && !isGeneric(fromError) ? fromError : undefined;
        return kind ? `${kind}: ${nestedMeaningful}` : nestedMeaningful;
      }

      // Fall through to stringify the nested object if it has no standard
      // message fields — e.g. { code: "ERR_X", status: 400 } — so we still
      // surface those identifiers to the user.
      const nestedRaw = stringifyBody(nested);
      if (nestedRaw && nestedRaw !== "{}") {
        return nestedRaw;
      }
    }

    const meaningful = firstMeaningful(fromMessage, fromError, fromDetail, fromReason);
    if (meaningful) {
      // When both `error` and `message` are present and they differ, prefer
      // showing both so the user sees the category + the description.
      if (
        fromError &&
        fromMessage &&
        fromMessage !== fromError &&
        !isGeneric(fromError) &&
        !isGeneric(fromMessage)
      ) {
        return `${fromError}: ${fromMessage}`;
      }
      return meaningful;
    }

    // No meaningful top-level fields — dump the raw JSON so that the user at
    // least sees the server payload. Attach status for context.
    const raw = stringifyBody(body);

    // Collapse empty / near-empty payloads to a friendlier message — there's
    // nothing for the user to see in `{}` anyway.
    if (!raw || raw === "{}" || raw === '""' || raw === "null") {
      return options.status
        ? `Request failed with status ${options.status}`
        : "Unknown error occurred";
    }

    const withStatus = options.status ? `status ${options.status} ${raw}` : raw;
    return `server returned ${withStatus}`;
  }

  return String(error);
}

/**
 * Builds a fully-qualified error message for a specific operation, including
 * the operation name and the extracted server-side message.
 */
export function formatApiErrorForOperation(
  operation: string,
  error: unknown,
  options: FormatApiErrorOptions = {},
): string {
  const message = formatApiErrorMessage(error, options);
  return `Failed to ${operation}: ${message}`;
}

/**
 * Attempts to read a status code from common response-shaped wrappers without
 * assuming a particular SDK. Returns undefined if none is found.
 */
export function extractStatusFromResponse(value: unknown): number | undefined {
  if (!value || typeof value !== "object") return undefined;
  const obj = value as Record<string, unknown>;
  if (typeof obj.status === "number") return obj.status;
  if (typeof obj.statusCode === "number") return obj.statusCode;
  if (obj.response && typeof obj.response === "object") {
    const resp = obj.response as Record<string, unknown>;
    if (typeof resp.status === "number") return resp.status;
  }
  return undefined;
}
