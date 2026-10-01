import type { PriorSession } from "@langwatch/auth-contract";
import { Temporal, type Instant } from "@langwatch/time";

import type { AuthSessionRepository } from "../repositories/auth-session.repository.ts";
import { presentedSessionCookie } from "../rules/session-cookie.rules.ts";

export interface PriorSessionServiceDeps {
  sessions: Pick<AuthSessionRepository, "findExpiryByToken">;
  /** The address to greet; null when the account went after the session did. */
  findEmail(input: { userId: string }): Promise<string | null>;
  now: () => Instant;
}

const UNKNOWN: PriorSession = { kind: "unknown" };

/**
 * Classifies the caller's own session cookie so an expired session can carry
 * its address to the sign-in screen. Only an expired row earns recovery; a
 * revoked, forged or still-live one answers `unknown` (main's PriorSessionService).
 */
export class PriorSessionService {
  static create(deps: PriorSessionServiceDeps): PriorSessionService {
    return new PriorSessionService(deps);
  }

  private constructor(private readonly deps: PriorSessionServiceDeps) {}

  async explain({ headers }: { headers: Headers }): Promise<PriorSession> {
    const cookie = presentedSessionCookie(headers);
    if (cookie.kind === "absent") return UNKNOWN;

    const [session] = await this.deps.sessions.findExpiryByToken({ token: cookie.token });
    if (!session) return UNKNOWN;
    if (Temporal.Instant.compare(session.expires, this.deps.now()) > 0) return UNKNOWN;

    const email = await this.deps.findEmail({ userId: session.userId });
    if (!email) return UNKNOWN;

    return { kind: "expired", email };
  }
}
