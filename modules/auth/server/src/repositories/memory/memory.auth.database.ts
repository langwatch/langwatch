import type { Instant } from "@langwatch/time";
import type { StoredBrowserSession } from "../auth-session.repository.ts";

/** One confirmation token, exactly as the row holds it. */
export type StoredVerificationToken = {
  identifier: string;
  token: string;
  expires: Instant;
};

/**
 * The two tables auth owns, in memory.
 *
 * Shared by both twins because they are one store: a test that mints a session
 * and then revokes it through the app must see one set of rows, and two
 * databases behind one repository set would let the app pass against state
 * nothing else can see.
 */
export class MemoryAuthDatabase {
  readonly sessions = new Map<string, StoredBrowserSession>();
  readonly verificationTokens = new Map<string, StoredVerificationToken>();

  private constructor() {}

  static create(): MemoryAuthDatabase {
    return new MemoryAuthDatabase();
  }
}
