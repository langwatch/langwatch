/** Subset of handled-error payload relevant to auth; validates all fields. */

/** The client-side view of a handled error, after validation. */
export type AuthHandledError = {
  code: string;
  httpStatus: number;
  meta: Record<string, unknown>;
  tips: readonly string[];
  traceId: string | undefined;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The candidate's error code, from whichever of the two fields the server used. */
function errorCandidateCode(candidate: Record<string, unknown>): string | null {
  if (typeof candidate.code === "string") return candidate.code;
  if (typeof candidate.kind === "string") return candidate.kind;
  return null;
}

/** More than this above a form is a document, not remediation. */
const MAX_TIPS = 4;

/** Longer than this is a diagnostic, not a sentence. */
const MAX_PROSE_LENGTH = 200;

/**
 * Server prose, clamped to a sentence — a length clamp, not a safety
 * boundary, since callers pass text LangWatch wrote. Sliced by grapheme
 * to avoid cutting a character in half.
 */
export function safeProse(value: string): string {
  const collapsed = value.replace(/\s+/g, " ").trim();
  if (collapsed.length === 0) return "";
  if (collapsed.length <= MAX_PROSE_LENGTH) return collapsed;
  const graphemes = Array.from(new Intl.Segmenter().segment(collapsed), ({ segment }) => segment);
  const kept = graphemes.slice(0, MAX_PROSE_LENGTH - 1).join("");
  return `${kept.trimEnd()}…`;
}

function safeTips(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((tip): tip is string => typeof tip === "string")
    .slice(0, MAX_TIPS)
    .map(safeProse)
    .filter((tip) => tip.length > 0);
}

/**
 * The tRPC envelope's payload, or `null` when the failure was not a handled
 * one. `kind` is the deprecated pre-`HandledError` discriminant, read as a
 * fallback so a payload from an older server still resolves.
 */
export function readHandledError(error: unknown): AuthHandledError | null {
  const candidate = (error as { data?: { error?: unknown } } | null)?.data?.error;
  if (!isRecord(candidate)) return null;

  const code = errorCandidateCode(candidate);
  if (code === null) return null;
  if (typeof candidate.httpStatus !== "number") return null;

  return {
    code,
    httpStatus: candidate.httpStatus,
    meta: isRecord(candidate.meta) ? candidate.meta : {},
    tips: safeTips(candidate.tips),
    traceId: typeof candidate.traceId === "string" ? candidate.traceId : undefined,
  };
}

/** The trace id a boundary attached outside the handled payload. */
export function readErrorTraceId(error: unknown): string | undefined {
  const handled = readHandledError(error);
  if (handled?.traceId) return handled.traceId;
  const traceId = (error as { data?: { traceId?: unknown } } | null)?.data?.traceId;
  return typeof traceId === "string" ? traceId : undefined;
}

/** Extracts authored error message; refuses machine-generated strings. */
export function readAuthoredMessage(error: unknown): string | undefined {
  if (readHandledError(error)) return undefined;

  const data = (error as { data?: { httpStatus?: unknown; authored?: unknown } } | null)?.data;

  // The fact, not a guess about it. Without this the channel also carried
  // `new TRPCError({ code: "NOT_FOUND" })` — whose message tRPC defaults to
  // the code NAME, so the customer read "NOT_FOUND".
  if (data?.authored !== true) return undefined;

  const status = data.httpStatus;
  if (typeof status !== "number" || status >= 500) return undefined;

  const message = (error as { message?: unknown } | null)?.message;
  if (typeof message !== "string" || message.length === 0) return undefined;

  if (SLUG_SHAPED.test(message)) return undefined;
  if (SCREAMING_CASE.test(message)) return undefined;
  if (message.length > MAX_AUTHORED_LENGTH) return undefined;
  if (MACHINE_PROSE.test(message)) return undefined;

  return message;
}

/** Belt and braces for a code newer than this client: still slug-shaped. */
const SLUG_SHAPED = /^[a-z0-9]+(_[a-z0-9]+)*$/;

/** `NOT_FOUND`, `UNAUTHORIZED` — a tRPC code name, not a sentence. */
const SCREAMING_CASE = /^[A-Z][A-Z0-9_]*$/;

/**
 * Longer than this and nobody wrote it for a customer: authored copy is a
 * sentence or two, and a stack frame or a driver diagnostic runs to hundreds
 * of characters.
 */
const MAX_AUTHORED_LENGTH = 200;

/**
 * Shapes that mean a machine wrote this string, not a person. Deliberately
 * conservative and case-SENSITIVE: a false positive silently replaces good
 * copy with "we've been notified".
 */
const MACHINE_PROSE = new RegExp(
  [
    "\\bprisma\\.",
    "\\bPrismaClient",
    "\\b(?:SELECT|INSERT INTO|UPDATE|DELETE FROM)\\b.*\\b(?:FROM|WHERE|VALUES|SET)\\b",
    "\\b(?:ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENOTFOUND|EPIPE|EAI_AGAIN)\\b",
    "(?:^|\\n)\\s*at\\s+\\S+\\s+\\(",
    "\\b[A-Z]\\w*Error:\\s",
    "\\bnode_modules\\b",
    "\\b\\d{1,3}(?:\\.\\d{1,3}){3}:\\d+",
    "\\b(?:invocation|constraint failed|deadlock detected)\\b",
  ].join("|"),
);
