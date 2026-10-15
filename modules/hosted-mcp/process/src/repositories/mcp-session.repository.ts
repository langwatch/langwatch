/**
 * A session record read: the key it was opened with, opened again, the project it was opened for
 * and the person behind an OAuth bearer (each absent on records older replicas wrote), or nothing.
 */
export type McpSessionRecordLookup =
  | Readonly<{
      kind: "found";
      /** When the session ends (epoch ms): 30 days after it opened. */
      expiresAt: number;
      apiKey: string;
      projectId: string | undefined;
      userId: string | undefined;
    }>
  | Readonly<{ kind: "missing" }>;

/** Reversible encryption for the credential a session record holds at rest. */
export interface McpSessionCipher {
  encrypt(plaintext: string): string;
  decrypt(ciphertext: string): string;
}

/**
 * Session records every replica can read, so a session opened on one replica can be found,
 * counted and reached from another. A session lasts 30 days from when it opened, or until the
 * client's DELETE; a replica shutting down or dropping an idle local copy never removes it.
 */
export abstract class McpSessionRepository {
  /** False where the deployment has no shared store; records are then kept nowhere. */
  abstract isAvailable(): boolean;

  /** Records a newly opened session for 30 days; an id already recorded is left as it is. */
  abstract store(input: {
    sessionId: string;
    apiKey: string;
    projectId?: string;
    userId?: string;
  }): Promise<void>;

  /**
   * Rewrites a recorded session (a refreshed token, a backfilled project), keeping the time it has
   * left. A record already removed stays removed, so a late rewrite cannot undo a client's DELETE.
   */
  abstract rewrite(input: {
    sessionId: string;
    apiKey: string;
    projectId?: string;
    userId?: string;
  }): Promise<void>;

  /** Marks the session active now for the key's session count; it never extends the session. */
  abstract touch(input: { sessionId: string; apiKey: string }): Promise<void>;

  /** A record whose key cannot be opened throws; the caller reads that as missing. */
  abstract getRecord(input: { sessionId: string }): Promise<McpSessionRecordLookup>;

  /** Ends the session for good: only the client's own DELETE calls this. */
  abstract remove(input: { sessionId: string; apiKey?: string }): Promise<void>;

  /** Stops counting the session against a key it no longer runs under (a refreshed token). */
  abstract forgetKey(input: { sessionId: string; apiKey: string }): Promise<void>;

  /** Sessions of one key active at or after `since` (epoch ms). */
  abstract countActive(input: { apiKey: string; since: number }): Promise<number>;
}
