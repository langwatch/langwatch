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

interface ZodIssue {
  path?: unknown;
  message?: unknown;
}

/**
 * Renders a Zod validation error body into a user-readable string. Returns
 * undefined if `body` is not a Zod error shape.
 *
 * Examples:
 *   { name: "ZodError", issues: [{ path: ["format"], message: "Invalid enum value..." }] }
 *   → "Validation failed: format — Invalid enum value..."
 *   { name: "ZodError", issues: [<issue1>, <issue2>] }
 *   → "Validation failed: a.b — msg1; c — msg2"
 */
function formatZodIssues(body: Record<string, unknown>): string | undefined {
  const isZod =
    body.name === "ZodError" ||
    (Array.isArray(body.issues) && body.issues.length > 0);
  if (!isZod || !Array.isArray(body.issues)) return undefined;

  const rendered = (body.issues as ZodIssue[])
    .map((issue) => {
      const pathArr = Array.isArray(issue.path) ? issue.path : [];
      const path = pathArr
        .filter((p) => typeof p === "string" || typeof p === "number")
        .join(".");
      const msg = typeof issue.message === "string" ? issue.message : "";
      if (path && msg) return `${path} — ${msg}`;
      if (msg) return msg;
      if (path) return path;
      return undefined;
    })
    .filter((s): s is string => typeof s === "string" && s.length > 0);

  if (rendered.length === 0) return undefined;
  return `Validation failed: ${rendered.join("; ")}`;
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

export interface FormatApiErrorMessageParams {
  error: unknown;
  /** Currently only `status` — kept as an object for forward extension. */
  options?: FormatApiErrorOptions;
}

export function formatApiErrorMessage({
  error,
  options = {},
}: FormatApiErrorMessageParams): string {
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
    // Node's fetch wraps transport failures as `TypeError: fetch failed` with
    // the real reason (ECONNREFUSED, ENOTFOUND, timeout, etc.) on `.cause`.
    // Surface that so the user can tell whether the endpoint is wrong, the
    // server is down, or DNS can't resolve the host.
    const base = error.message || "Unknown error occurred";
    const cause = (error as { cause?: unknown }).cause;
    const causeMsg =
      cause instanceof Error
        ? cause.message
        : cause && typeof cause === "object" &&
            typeof (cause as { message?: unknown }).message === "string"
          ? (cause as { message: string }).message
          : undefined;
    const causeCode =
      cause && typeof cause === "object" &&
      typeof (cause as { code?: unknown }).code === "string"
        ? (cause as { code: string }).code
        : undefined;

    const detail = [causeCode, causeMsg && causeMsg !== base ? causeMsg : undefined]
      .filter((s): s is string => typeof s === "string" && s.length > 0)
      .join(": ");
    const formatted = detail ? `${base} (${detail})` : base;

    // Node fetch emits "TypeError: fetch failed" with `cause.message =
    // "unknown scheme"` when the URL has no/invalid scheme (e.g. the user
    // set LANGWATCH_ENDPOINT=localhost:5570 instead of http://localhost:5570).
    // Add a hint — the raw phrase tells the user nothing actionable.
    const combined = `${base} ${causeMsg ?? ""} ${causeCode ?? ""}`.toLowerCase();
    if (
      combined.includes("unknown scheme") ||
      combined.includes("err_invalid_url") ||
      combined.includes("failed to parse url")
    ) {
      return `${formatted} — check your LANGWATCH_ENDPOINT (must start with http:// or https://)`;
    }
    return formatted;
  }

  if (typeof error === "object") {
    const body = error as Record<string, unknown>;

    // Zod validation errors: `{ name: "ZodError", issues: [{ path, message }] }`.
    // Without this they render as unreadable raw JSON to the user.
    const zod = formatZodIssues(body);
    if (zod) return zod;

    // Most specific fields first.
    const fromMessage = typeof body.message === "string" ? body.message : undefined;
    const fromError = typeof body.error === "string" ? body.error : undefined;
    const fromDetail = typeof body.detail === "string" ? body.detail : undefined;
    const fromReason = typeof body.reason === "string" ? body.reason : undefined;

    // 1. Top-level meaningful fields take priority. If the server gave us a
    //    descriptive `message`/`error`/`detail`/`reason`, use that — even if
    //    `body.error` is an object with its own (potentially generic) message.
    const meaningful = firstMeaningful(fromMessage, fromError, fromDetail, fromReason);
    if (meaningful) {
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

    // 2. Nested `body.error` — only used as a fallback when no top-level
    //    field carried a useful message. Native Error instances and
    //    tRPC-style envelopes both fit here.
    if (body.error && typeof body.error === "object") {
      const nested = body.error as Record<string, unknown>;

      if (body.error instanceof Error && body.error.message) {
        return body.error.message;
      }

      // Zod validation envelopes: `{ success: false, error: { name: "ZodError", issues: [...] } }`
      const nestedZod = formatZodIssues(nested);
      if (nestedZod) return nestedZod;

      const fromNestedMsg = typeof nested.message === "string" ? nested.message : undefined;
      const fromNestedErr = typeof nested.error === "string" ? nested.error : undefined;
      const nestedMeaningful = firstMeaningful(fromNestedMsg, fromNestedErr);
      if (nestedMeaningful) {
        return nestedMeaningful;
      }

      // Stringify the nested object so identifiers like `{ code, status }`
      // still reach the user.
      const nestedRaw = stringifyBody(nested);
      if (nestedRaw && nestedRaw !== "{}") {
        return nestedRaw;
      }
    }

    // 3. No meaningful top-level or nested fields — dump the raw JSON so
    //    the user at least sees the server payload. Attach status for
    //    context.
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

  // Primitive types (number, boolean, bigint, symbol) — coerce safely.
  // We've already handled string, null/undefined, Error, and object above.
  try {
    return String(error as number | boolean | bigint);
  } catch {
    return "Unknown error occurred";
  }
}

export interface FormatApiErrorForOperationParams {
  operation: string;
  error: unknown;
  options?: FormatApiErrorOptions;
}

/**
 * Builds a fully-qualified error message for a specific operation, including
 * the operation name and the extracted server-side message.
 */
export function formatApiErrorForOperation({
  operation,
  error,
  options = {},
}: FormatApiErrorForOperationParams): string {
  const message = formatApiErrorMessage({ error, options });
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
