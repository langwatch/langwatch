import type { Instant } from "@langwatch/time";

import type { BrowserSessionRecord, StoredBrowserSession } from "../auth-session.repository.ts";

/**
 * A session in memory. The inventory columns are optional because the rows a
 * test mints to exercise revocation carry none, and a devices list that reads
 * them absent answers exactly what a session minted before the columns does.
 */
export type MemoryStoredSession = StoredBrowserSession & Partial<Omit<BrowserSessionRecord, "id">>;

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
  readonly sessions = new Map<string, MemoryStoredSession>();
  readonly verificationTokens = new Map<string, StoredVerificationToken>();

  private constructor() {}

  static create(): MemoryAuthDatabase {
    return new MemoryAuthDatabase();
  }
}
