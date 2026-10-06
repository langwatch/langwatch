/** The two MCP transports; each keeps its own records and lifetime. */
export type McpSessionTransport = "streamable" | "sse";

/**
 * A session record read: the key it was opened with, opened again, and the project it was
 * opened for (absent on records older replicas wrote), or nothing.
 */
export type McpSessionRecordLookup =
  | Readonly<{ kind: "found"; apiKey: string; projectId: string | undefined }>
  | Readonly<{ kind: "missing" }>;

/** Reversible encryption for the credential a session record holds at rest. */
export interface McpSessionCipher {
  encrypt(plaintext: string): string;
  decrypt(ciphertext: string): string;
}

/**
 * Session records every replica can read, so a session opened on one replica can be found,
 * counted and reached from another.
 */
export abstract class McpSessionRepository {
  /** False where the deployment has no shared store; records are then kept nowhere. */
  abstract isAvailable(): boolean;

  abstract store(input: {
    transport: McpSessionTransport;
    sessionId: string;
    apiKey: string;
    projectId?: string;
  }): Promise<void>;

  abstract touch(input: {
    transport: McpSessionTransport;
    sessionId: string;
    apiKey: string;
  }): Promise<void>;

  /** A record whose key cannot be opened throws; the caller reads that as missing. */
  abstract getRecord(input: {
    transport: McpSessionTransport;
    sessionId: string;
  }): Promise<McpSessionRecordLookup>;

  abstract remove(input: {
    transport: McpSessionTransport;
    sessionId: string;
    apiKey?: string;
  }): Promise<void>;

  /** Live sessions of both transports for one key; stale set entries are cleared on the way. */
  abstract countLive(input: { apiKey: string }): Promise<number>;
}
