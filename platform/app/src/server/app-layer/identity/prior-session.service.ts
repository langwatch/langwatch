/**
 * Why somebody is looking at the sign-in screen, when the answer is knowable.
 *
 * The session gate sends every unauthenticated arrival to the same cold screen:
 * an empty address box, greeting a stranger. For most arrivals that is the only
 * honest thing to show, because the browser has told us nothing. But the four
 * ways a request can arrive unauthenticated are not equally ignorant, and one of
 * them we know everything about:
 *
 *   ┌──────────────────────────┬──────────────────────────────────────────────┐
 *   │ no cookie                │ nothing known — new person, cleared cookies, │
 *   │                          │ another browser, incognito, a shared link    │
 *   │ cookie, no session row   │ the session was ENDED ON PURPOSE             │
 *   │ cookie, row expired      │ exactly who, and that this browser was in    │
 *   │ cookie, no matching row  │ a string somebody handed us; maybe a forgery │
 *   └──────────────────────────┴──────────────────────────────────────────────┘
 *
 * Only the third earns recovery. Sessions last thirty days, so it is rare, and
 * when it happens the person gets their address filled in and lands on the step
 * that asks them to prove it.
 *
 * The second must NOT, and that is the security property here rather than a
 * nicety. Ending every session is what somebody does when they think a machine
 * is no longer theirs; printing the account's address on that machine afterwards
 * would undo the thing they just asked for. A revoked session is therefore
 * indistinguishable, from the screen's point of view, from never having been
 * here — which is also why `explain` answers the SAME shape for rows 1, 2 and 4
 * and keeps no reason code for them.
 *
 * ── What this is not ───────────────────────────────────────────────────────
 *
 * Not authentication. An expired session is a fact about the past, not a
 * credential: it shortens the walk by one step and never replaces a step of it.
 * Nothing here mints anything, and the caller still has to prove who they are.
 *
 * Not an enumeration surface. `explain` takes NO input — it reads the cookie the
 * caller themselves presented — so the most it can ever describe is a session
 * that caller already holds. There is no address to pass in and therefore no
 * question to ask about somebody else's.
 */

/**
 * What the sign-in screen is told.
 *
 * `recognized` carries the address and nothing else — no user id, no session id,
 * no list of methods. The screen needs an address to fill in; everything beyond
 * that would be the endpoint volunteering facts about an account to a caller who
 * has not yet proved they own it.
 */
export type PriorSession =
  | { kind: "expired"; email: string }
  | { kind: "unknown" };

/** Answered for rows 1, 2 and 4 alike — see the class docblock. */
const UNKNOWN: PriorSession = { kind: "unknown" };

/**
 * better-auth signs the session cookie as `<token>.<signature>`, and the column
 * holds the token alone. Tokens are generated without dots, so the first one is
 * the separator.
 *
 * A value with no dot is returned as-is rather than rejected: an unsigned cookie
 * still names a token, and if it names one that does not exist the lookup
 * answers `unknown` anyway. Refusing it here would only add a second way to say
 * the same thing.
 */
export function sessionTokenFromCookieValue(
  value: string | null | undefined,
): string | null {
  if (!value) return null;
  const token = value.split(".")[0];
  return token && token.length > 0 ? token : null;
}

/**
 * A session as this decision needs it: when it stopped being usable, and the
 * address to greet. Flat rather than Prisma's nesting, so the rule below reads
 * as a rule rather than as a shape.
 */
export interface PriorSessionRow {
  expires: Date;
  /** Null when the account went after the session did — nobody to greet. */
  email: string | null;
}

/** The one read this makes. ADR-129 keeps the query itself one tier down. */
export interface PriorSessionRepository {
  findByToken(input: { token: string }): Promise<PriorSessionRow | null>;
}

export interface PriorSessionServiceDeps {
  repository: PriorSessionRepository;
  /** Wall-clock, injected so a test can sit either side of `expires`. */
  now: () => Date;
}

export class PriorSessionService {
  constructor(private readonly deps: PriorSessionServiceDeps) {}

  /**
   * Classify the caller's own session cookie.
   *
   * Takes the raw cookie value — whatever better-auth's `getSessionCookie` found
   * — rather than a request, so the decision is testable without a transport and
   * the cookie-name knowledge stays at the boundary that already owns it.
   */
  async explain({
    sessionCookie,
  }: {
    sessionCookie: string | null | undefined;
  }): Promise<PriorSession> {
    const token = sessionTokenFromCookieValue(sessionCookie);
    if (!token) return UNKNOWN;

    const session = await this.deps.repository.findByToken({ token });

    // No row: either revoked, or a token we never issued. Both answer the same
    // thing, deliberately — see the class docblock. Nothing distinguishes them
    // on screen, so a forged cookie learns nothing from having parsed.
    if (!session) return UNKNOWN;

    // A row that has NOT expired means the gate rejected this request for some
    // other reason — an impersonation guard, a cache miss mid-revocation, a
    // required second factor. Whatever it is, "your session expired" would be
    // false, so it is not said.
    if (session.expires > this.deps.now()) return UNKNOWN;

    // The account went after the session did. There is nobody to greet.
    const email = session.email;
    if (!email) return UNKNOWN;

    return { kind: "expired", email };
  }
}
