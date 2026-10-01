import { McpSessionRelayChannel } from "../mcp-session-relay.channel.ts";

/** One process is one replica: a message reaches a listener here or nobody. */
export class MemoryMcpSessionRelayChannel extends McpSessionRelayChannel {
  readonly #listeners = new Map<string, (raw: string) => void>();

  private constructor() {
    super();
  }

  static create(): MemoryMcpSessionRelayChannel {
    return new MemoryMcpSessionRelayChannel();
  }

  listen({
    sessionId,
    onMessage,
  }: {
    sessionId: string;
    onMessage: (raw: string) => void;
  }): Promise<void> {
    this.#listeners.set(sessionId, onMessage);
    return Promise.resolve();
  }

  stopListening({ sessionId }: { sessionId: string }): Promise<void> {
    this.#listeners.delete(sessionId);
    return Promise.resolve();
  }

  publish({ sessionId, message }: { sessionId: string; message: string }): Promise<number> {
    const listener = this.#listeners.get(sessionId);
    listener?.(message);
    return Promise.resolve(listener ? 1 : 0);
  }

  close(): void {
    this.#listeners.clear();
  }
}
