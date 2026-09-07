/**
 * The handled-error payload, as much of it as this family reads.
 *
 * `platform/app/src/features/errors/logic/readHandledError.ts` validates the
 * whole envelope from both boundaries and hands back nine fields. This family
 * asks it two questions — which code came back, and whether the server named a
 * field that was rejected — so that is what travels here.
 *
 * A COPY of the same nine lines `@langwatch/gateway-web`,
 * `@langwatch/automation-web`, `@langwatch/annotation-web` and
 * `@langwatch/enterprise-governance-web` carry, for the same reason and with
 * the same gap: the reader belongs with the presentation registry it feeds, and
 * five families will converge on one when that registry moves out of
 * `platform/app`.
 *
 * Trusts nothing: a misconfigured or older server must not be able to crash a
 * render by omitting a field.
 */

export type UserHandledError = {
  code: string;
  httpStatus: number;
  /** Whatever the code documented. Read by key, never spread into the UI. */
  meta: Record<string, unknown>;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The tRPC envelope's payload, or `null` when the failure was not a handled one. */
export function readHandledError(error: unknown): UserHandledError | null {
  const candidate = (error as { data?: { error?: unknown } } | null)?.data?.error;
  if (!isRecord(candidate)) return null;

  const code = typeof candidate.code === "string" ? candidate.code : null;
  if (code === null) return null;
  if (typeof candidate.httpStatus !== "number") return null;

  return {
    code,
    httpStatus: candidate.httpStatus,
    meta: isRecord(candidate.meta) ? candidate.meta : {},
  };
}

/**
 * What the server said about individual fields, if it named any.
 *
 * A NARROWED `applyHandledErrorToForm`. The platform helper is 130 lines
 * because it also decides whether the caller may suppress its toast, which
 * turns on whether the form paints a root-error slot; this dialog always paints
 * one, so the decision is not this function's to make. What survives is the
 * reading — only a `validation_error` names fields, and only the FIRST message
 * per field fits beside an input.
 */
export function fieldProblems(error: unknown): Record<string, string> {
  const handled = readHandledError(error);
  if (handled?.code !== "validation_error") return {};
  const raw = handled.meta.fieldErrors;
  if (!isRecord(raw)) return {};
  const problems: Record<string, string> = {};
  for (const [field, messages] of Object.entries(raw)) {
    const first = Array.isArray(messages) ? messages[0] : messages;
    if (typeof first === "string") problems[field] = first;
  }
  return problems;
}

/**
 * What the server said about the submission as a whole.
 *
 * `meta.formErrors` is forwarded verbatim from an upstream body on a relayed
 * error, so the number of complaints is not ours to trust: the list is capped
 * rather than rendered whole.
 */
const MAX_FORM_ERRORS = 3;

export function formProblems(error: unknown): string[] {
  const handled = readHandledError(error);
  if (handled?.code !== "validation_error") return [];
  const raw = handled.meta.formErrors;
  if (!Array.isArray(raw)) return [];
  return raw
    .filter((entry): entry is string => typeof entry === "string")
    .slice(0, MAX_FORM_ERRORS);
}

/**
 * Longer than this and nobody wrote it for a customer.
 *
 * Authored copy is a sentence or two ("Current password is incorrect"). A stack
 * frame, a serialised query or a driver's diagnostic block runs to hundreds of
 * characters, and length alone separates them reliably.
 */
const MAX_AUTHORED_LENGTH = 200;

/** `NOT_FOUND`, `UNAUTHORIZED` — a tRPC code name, not a sentence. */
const SCREAMING_CASE = /^[A-Z][A-Z0-9_]*$/;

/** `validation_error` — a code slug, not a sentence. */
const SLUG_SHAPED = /^[a-z0-9]+(_[a-z0-9]+)*$/;

/**
 * Shapes that mean a machine wrote this string, not a person.
 *
 * Deliberately conservative in ONE direction: every pattern here has to be
 * something no product person would ever type, because a false positive
 * silently replaces good copy with "something went wrong on our side". That is
 * why the SQL pattern is case-SENSITIVE — an earlier version of the platform
 * guard matched case-insensitively and would have eaten "Select a template from
 * the list before running this."
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
  ].join("|"),
);

/**
 * Prose a procedure deliberately authored for the reader, on an error that is
 * not a `HandledError`.
 *
 * WHY THIS TRAVELS WITH THE FAMILY. #5984 collapsed the wire message to the
 * code for handled errors and to a generic string for unhandled 5xx, but it
 * deliberately left a plain non-5xx `TRPCError`'s message alone, because that
 * is copy the procedure wrote to be read. `user.changePassword` throws exactly
 * one: a 401 saying WHICH password was wrong, which is the only thing that
 * tells a reader to retype the first field rather than the second.
 *
 * The application's feedback capability resolves copy from a code, and an
 * authored error carries none — so it would degrade this to the generic line.
 * The screen therefore reads it and passes it as the notice's `description`,
 * which the capability uses only where there is no code, so it can never talk
 * over registered copy.
 *
 * A NARROWED COPY of `platform/app/src/features/errors/logic/readHandledError.ts`'s
 * `readAuthoredMessage`, keeping both of its layers: the server's own
 * `data.authored` flag (it needs `cause`, which never crosses the wire) and the
 * independent machine-prose refusal, because the cost of being wrong here is a
 * Prisma string in front of a customer.
 */
export function authoredMessage(error: unknown): string | undefined {
  if (readHandledError(error)) return void 0;

  const data = (error as { data?: { httpStatus?: unknown; authored?: unknown } } | null)?.data;
  if (data?.authored !== true) return void 0;

  const status = data.httpStatus;
  if (typeof status !== "number" || status >= 500) return void 0;

  const message = (error as { message?: unknown } | null)?.message;
  if (typeof message !== "string" || message.length === 0) return void 0;
  if (SLUG_SHAPED.test(message) || SCREAMING_CASE.test(message)) return void 0;
  if (message.length > MAX_AUTHORED_LENGTH) return void 0;
  if (MACHINE_PROSE.test(message)) return void 0;

  return message;
}
