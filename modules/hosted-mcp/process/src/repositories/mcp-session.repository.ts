/**
 * A session record read: the key it was opened with, opened again, the project it was opened for
 * and the person behind an OAuth bearer (each absent on records older replicas wrote), or nothing.
 */
export type McpSessionRecordLookup =
  | Readonly<{
      kind: "found";
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
 * counted and reached from another. A record ends by its TTL or by the client's DELETE; a replica
 * shutting down or dropping an idle local copy never removes it.
 */
export abstract class McpSessionRepository {
  /** False where the deployment has no shared store; records are then kept nowhere. */
  abstract isAvailable(): boolean;

  abstract store(input: {
    sessionId: string;
    apiKey: string;
    projectId?: string;
    userId?: string;
  }): Promise<void>;

  /** Extends the record's life and marks it active now for the key's session count. */
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
