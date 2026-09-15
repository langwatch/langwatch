import type { SessionWorkingContext } from "@langwatch/coding-agent-contract";
import {
  CodingAgentSessionContextMemoRepository,
  SESSION_CONTEXT_MEMO_TTL_SECONDS,
} from "../session-context-memo.repository.ts";

/**
 * How many sessions the no-Redis fallback keeps.
 */
const IN_MEMORY_MEMO_MAX_ENTRIES = 10_000;

/**
 * Test double, and the fallback for a preset with no Redis.
 */
export class MemorySessionContextMemoRepository extends CodingAgentSessionContextMemoRepository {
  private readonly entries = new Map<
    string,
    { context: SessionWorkingContext; expiresAtMs: number }
  >();

  constructor(private readonly now: () => number = Date.now) {
    super();
  }

  static create(now: () => number = Date.now): MemorySessionContextMemoRepository {
    return new MemorySessionContextMemoRepository(now);
  }

  async find({
    tenantId,
    sessionId,
  }: {
    tenantId: string;
    sessionId: string;
  }): Promise<SessionWorkingContext | null> {
    const key = CodingAgentSessionContextMemoRepository.memoKey({ tenantId, sessionId });
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
    const key = CodingAgentSessionContextMemoRepository.memoKey({ tenantId, sessionId });
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
