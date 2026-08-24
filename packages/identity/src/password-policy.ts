/**
 * What counts as an acceptable password, in the one place both sides read.
 *
 * The form and the mutation behind it have to agree exactly. When they drift,
 * one of two things happens and both are bad: the form accepts what the server
 * rejects, so somebody is refused after committing, in server words rather
 * than field words; or the form rejects what the server accepts, so a rule
 * nobody wrote down is enforced anyway. This module is the agreement.
 *
 * Deliberately RULES rather than a schema. `packages/identity` and the app do
 * not sit on the same zod major, and a schema crossing that boundary brings
 * its `ZodError` with it — which `instanceof` no longer recognises on the far
 * side. So each side builds its own schema and both ask this the same
 * question, getting the same sentence back.
 *
 * The rules themselves are deliberately few. Length is what makes a password
 * hard to guess; composition rules ("one capital, one symbol") mostly produce
 * `Password1!` and a sticky note, and no longer appear in current guidance.
 */

/** Short enough to type, long enough to be worth typing. */
export const PASSWORD_MINIMUM_LENGTH = 8;

/**
 * bcrypt hashes the first 72 BYTES and silently ignores the rest, so anything
 * past this is not a longer password — it is the same password with unread
 * characters after it, and two that differ only there would both open the
 * account. Refused rather than truncated, because silently keeping less than
 * somebody typed is the version of this nobody can see.
 */
export const PASSWORD_MAXIMUM_BYTES = 72;

/** The hint the form shows before anybody has got it wrong. */
export const PASSWORD_REQUIREMENTS_HINT = `At least ${PASSWORD_MINIMUM_LENGTH} characters`;

/**
 * What is wrong with this password, or null when nothing is.
 *
 * One sentence, written to be shown to the person who typed it: it says what
 * to do, not which rule fired.
 */
export function passwordProblem(value: string): string | null {
  if (value.length < PASSWORD_MINIMUM_LENGTH) {
    return `Use at least ${PASSWORD_MINIMUM_LENGTH} characters`;
  }

  // Bytes, not characters: an emoji is four of them, so a short-looking
  // password can still be over the limit.
  if (new TextEncoder().encode(value).length > PASSWORD_MAXIMUM_BYTES) {
    return `Use at most ${PASSWORD_MAXIMUM_BYTES} characters`;
  }

  // Whitespace counts toward length, but a password that is nothing else is
  // impossible to retype reliably and usually a stuck key.
  if (value.trim().length === 0) {
    return "Use at least one character that is not a space";
  }

  return null;
}
