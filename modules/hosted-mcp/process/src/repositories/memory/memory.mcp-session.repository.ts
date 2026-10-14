import { nowInstant } from "@langwatch/time";

import { McpSessionRepository, type McpSessionRecordLookup } from "../mcp-session.repository.ts";

type MemoryRecord = {
  apiKey: string;
  projectId: string | undefined;
  userId: string | undefined;
};

/** Session records held in this process, keys in plaintext: one replica, every record its own. */
export class MemoryMcpSessionRepository extends McpSessionRepository {
  readonly #records = new Map<string, MemoryRecord>();
  /** Last activity per key, then per session id, as the Redis tier's sorted sets hold it. */
  readonly #activity = new Map<string, Map<string, number>>();

  private constructor() {
    super();
  }

  static create(): MemoryMcpSessionRepository {
    return new MemoryMcpSessionRepository();
  }

  isAvailable(): boolean {
    return true;
  }

  store(input: {
    sessionId: string;
    apiKey: string;
    projectId?: string;
    userId?: string;
  }): Promise<void> {
    this.#records.set(input.sessionId, {
      apiKey: input.apiKey,
      projectId: input.projectId,
      userId: input.userId,
    });
    this.#markActive(input);
    return Promise.resolve();
  }

  touch(input: { sessionId: string; apiKey: string }): Promise<void> {
    if (this.#records.has(input.sessionId)) this.#markActive(input);
    return Promise.resolve();
  }

  getRecord(input: { sessionId: string }): Promise<McpSessionRecordLookup> {
    const record = this.#records.get(input.sessionId);
    return Promise.resolve(record ? { kind: "found", ...record } : { kind: "missing" });
  }

  remove(input: { sessionId: string; apiKey?: string }): Promise<void> {
    this.#records.delete(input.sessionId);
    if (input.apiKey !== undefined) this.#activity.get(input.apiKey)?.delete(input.sessionId);
    return Promise.resolve();
  }

  forgetKey(input: { sessionId: string; apiKey: string }): Promise<void> {
    this.#activity.get(input.apiKey)?.delete(input.sessionId);
    return Promise.resolve();
  }

  countActive({ apiKey, since }: { apiKey: string; since: number }): Promise<number> {
    let count = 0;
    for (const at of this.#activity.get(apiKey)?.values() ?? []) {
      if (at >= since) count++;
    }
    return Promise.resolve(count);
  }

  #markActive(input: { sessionId: string; apiKey: string }): void {
    const byId = this.#activity.get(input.apiKey) ?? new Map<string, number>();
    byId.set(input.sessionId, nowInstant().epochMilliseconds);
    this.#activity.set(input.apiKey, byId);
  }
}
