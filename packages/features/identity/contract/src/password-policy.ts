/**
 * What counts as an acceptable password, in the one place both sides read. The form and the
 * mutation behind it have to agree exactly.
 */

/** Short enough to type, long enough to be worth typing. */
export const PASSWORD_MINIMUM_LENGTH = 8;

/**
 * bcrypt hashes the first 72 BYTES and silently ignores the rest, so anything past this is not
 * a longer password — it is the same password with unread characters after it, and two that
 * differ only there would both open the account.
 */
export const PASSWORD_MAXIMUM_BYTES = 72;

/** The hint the form shows before anybody has got it wrong. */
export const PASSWORD_REQUIREMENTS_HINT = `At least ${PASSWORD_MINIMUM_LENGTH} characters`;

/**
 * `TextEncoder` is a WHATWG global, present in every browser and in Node from 11 on — but its
 * TYPE ships only in `lib.dom.d.ts` or `@types/node`, and this package takes neither on purpose
 * (see the tsconfig: `types: []` is the isomorphism boundary, enforced by the compiler).
 */
declare const TextEncoder: new () => { encode(input: string): { length: number } };

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
