/**
 * Carries a client message to whichever replica holds the SSE stream for that session. The
 * reply travels back down the stream that replica holds, so the message comes to the stream.
 */
export abstract class McpSessionRelayChannel {
  /** Starts hearing a session's messages; a relay that cannot listen logs it and hears none. */
  abstract listen(input: { sessionId: string; onMessage: (raw: string) => void }): Promise<void>;

  abstract stopListening(input: { sessionId: string }): Promise<void>;

  /** How many replicas heard it; zero means the replica holding the stream is gone. */
  abstract publish(input: { sessionId: string; message: string }): Promise<number>;

  abstract close(): void;
}
