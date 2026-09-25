import { getSessionCookie } from "better-auth/cookies";

/** Whether the caller presented a session cookie, and the token it names. */
export type PresentedSessionCookie = { kind: "absent" } | { kind: "present"; token: string };

/**
 * better-auth owns the cookie's name and its `__Secure-` variant, and signs it
 * `<token>.<signature>`; tokens carry no dots, so the first one separates.
 */
export function presentedSessionCookie(headers: Headers): PresentedSessionCookie {
  const token = (getSessionCookie(headers) ?? "").split(".")[0] ?? "";
  return token.length > 0 ? { kind: "present", token } : { kind: "absent" };
}
