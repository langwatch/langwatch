import type { Instant } from "@langwatch/time";
import type { StoredBrowserSession } from "../auth-session.repository.ts";

/** One confirmation token, exactly as the row holds it. */
export type StoredVerificationToken = {
  identifier: string;
  token: string;
  expires: Instant;
};

/**
 * The two tables auth owns, in memory — shared by both twin repositories
 * since they are one store: a test that mints a session then revokes it
 * must see one set of rows, not state hidden behind a second database.
 */
export class MemoryAuthDatabase {
  readonly sessions = new Map<string, StoredBrowserSession>();
  readonly verificationTokens = new Map<string, StoredVerificationToken>();

  private constructor() {}

  static create(): MemoryAuthDatabase {
    return new MemoryAuthDatabase();
  }
}
