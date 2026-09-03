/**
 * The handled-error payload, as much of it as the front door reads.
 *
 * `platform/app/src/features/errors/logic/readHandledError.ts` validates the
 * whole envelope from both boundaries and hands back nine fields. The front
 * door asks three questions of it — which code came back (`invite_expired`,
 * `invite_wrong_account`, `email_already_registered`), what the server said
 * was wrong with which field, and whether there is a trace id worth showing —
 * and those are what travel. The same narrowing `@langwatch/enterprise-governance-web`
 * took, for the same reason: the full reader belongs with the presentation
 * registry it feeds, and both move in a later slice.
 *
 * Trusts nothing: a misconfigured or older server must not be able to crash a
 * render by omitting a field.
 */

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

/** More than this above a form is a document, not remediation. */
const MAX_TIPS = 4;

/** Longer than this is a diagnostic, not a sentence. */
const MAX_PROSE_LENGTH = 200;

/**
 * Server prose, clamped to something that can only ever be a sentence.
 *
 * A length clamp, not a safety boundary — the callers pass text LangWatch
 * wrote about the customer's own input. Sliced by code point, because cutting
 * a surrogate pair in half renders a replacement character.
 */
export function safeProse(value: string): string {
  const collapsed = value.replace(/\s+/g, " ").trim();
  if (collapsed.length === 0) return "";
  if (collapsed.length <= MAX_PROSE_LENGTH) return collapsed;
  const kept = [...collapsed].slice(0, MAX_PROSE_LENGTH - 1).join("");
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

  const code =
    typeof candidate.code === "string"
      ? candidate.code
      : typeof candidate.kind === "string"
        ? candidate.kind
        : null;
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

/**
 * Prose a procedure deliberately authored for the user, on an error that is
 * NOT a handled one.
 *
 * #5984 collapsed the wire message of a HANDLED error to its code, but
 * deliberately left a plain non-5xx `TRPCError`'s message alone, because that
 * is copy the procedure wrote to be read ("The invite was sent to …, but you
 * are signed in as …"). Dropping it in favour of "we've been notified" is
 * worse than the slug problem: it tells somebody to wait for something that
 * will never change.
 *
 * Harvested from `platform/app/src/features/errors/logic/readHandledError.ts`.
 * The server decides what counts as authored — it needs `cause`, which never
 * crosses the wire — and says so with `data.authored`. This trusts that flag
 * and then applies the same second, independent layer: a message that somehow
 * arrives marked authored but reads like a machine wrote it is still refused.
 * The one narrowing is the known-code set, which is this package's own
 * front-door table plus the slug shape rather than the whole `APP_ERROR_CODES`
 * list — a code outside it is still slug-shaped, which is what catches it.
 */
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
