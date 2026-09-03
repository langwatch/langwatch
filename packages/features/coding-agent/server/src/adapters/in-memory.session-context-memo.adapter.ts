import type { SessionWorkingContext } from "@langwatch/coding-agent-contract";
import {
  CodingAgentSessionContextMemoPort,
  SESSION_CONTEXT_MEMO_TTL_SECONDS,
  sessionContextMemoKey,
} from "../ports/coding-agent-session-context.port";

/**
 * How many sessions the no-Redis fallback keeps. A worker holds one entry per
 * session it is currently draining, and a few hundred bytes each, so this is
 * far above any real concurrency while still being a ceiling: without one the
 * map grows for the life of the process.
 */
const IN_MEMORY_MEMO_MAX_ENTRIES = 10_000;

/**
 * Test double, and the fallback for a preset with no Redis.
 *
 * Bounded two ways, because a process holding this map has no Redis to expire
 * it: entries carry the same TTL the Redis memo writes, and the map evicts its
 * oldest entry once it is full. An evicted session stamps nothing more, which
 * degrades to the legacy whole-session rule exactly like an expired Redis key.
 */
export class InMemorySessionContextMemoAdapter extends CodingAgentSessionContextMemoPort {
  private readonly entries = new Map<
    string,
    { context: SessionWorkingContext; expiresAtMs: number }
  >();

  constructor(private readonly now: () => number = Date.now) {
    super();
  }

  static create(now: () => number = Date.now): InMemorySessionContextMemoAdapter {
    return new InMemorySessionContextMemoAdapter(now);
  }

  async get({
    tenantId,
    sessionId,
  }: {
    tenantId: string;
    sessionId: string;
  }): Promise<SessionWorkingContext | null> {
    const key = sessionContextMemoKey({ tenantId, sessionId });
    const entry = this.entries.get(key);
    if (entry === undefined) return null;
    if (entry.expiresAtMs <= this.now()) {
      this.entries.delete(key);
      return null;
    }
    return entry.context;
  }

  async set({
    tenantId,
    sessionId,
    context,
  }: {
    tenantId: string;
    sessionId: string;
    context: SessionWorkingContext;
  }): Promise<void> {
    const key = sessionContextMemoKey({ tenantId, sessionId });
    // Re-inserting moves the key to the end of the Map's insertion order, so
    // the eviction below always drops the least recently written session.
    this.entries.delete(key);
    this.entries.set(key, {
      context,
      expiresAtMs: this.now() + SESSION_CONTEXT_MEMO_TTL_SECONDS * 1000,
    });
    while (this.entries.size > IN_MEMORY_MEMO_MAX_ENTRIES) {
      const oldest = this.entries.keys().next();
      if (oldest.done === true) break;
      this.entries.delete(oldest.value);
    }
  }
}
