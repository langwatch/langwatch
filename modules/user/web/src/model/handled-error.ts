/**
 * Handled-error payload: code and field rejections. Read from server via
 * platform/app's logic, duplicated in feature-web packages.
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

/** Server field rejections for validation errors, keyed by field name. */
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

/** Patterns that signal machine-generated text, not authored copy. */
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
 * Authored error message for non-5xx errors. Must be verified to exclude
 * machine-generated prose (Prisma, SQL, stack traces).
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
