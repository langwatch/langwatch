import type { DerivedTraceEvent } from "@langwatch/trace-contract";
import type { TraceDerivationSpanReaderPort } from "../ports/trace-derivation-span-reader.port";

/**
 * How long an unused memo entry lingers. Correctness comes from the fold
 * version in the key, never from aging: an entry for a superseded version is
 * simply never read again, so this only bounds how long it holds memory.
 */
const EVENT_DERIVATION_WINDOW_MS = 30_000;

/** Cap so a burst of distinct traces or versions cannot grow the memo. */
const EVENT_DERIVATION_MEMO_MAX_ENTRIES = 2_000;

interface MemoEntry {
  value: Promise<DerivedTraceEvent[]>;
  expiresAt: number;
}

/**
 * A trace's span events, read once per fold version.
 *
 * The memo is the whole point. A coalesced fold batch dispatches its
 * subscribers once per event but at ONE shared final state, so an events read
 * issued per subscriber would run once per span in the backlog — the read
 * amplification that re-saturates ClickHouse during a drain. Keying on the
 * fold's `spanCount` means one read serves the whole batch and a fold that has
 * advanced re-reads.
 *
 * Without a `foldVersion` the read passes straight through: a live read with no
 * watermark is non-deterministic over time and must never be served from cache.
 */
export class TraceEventDerivationService {
  static create(options: { spans: TraceDerivationSpanReaderPort }): TraceEventDerivationService {
    return new TraceEventDerivationService(options.spans);
  }

  private readonly memo = new Map<string, MemoEntry>();

  private constructor(private readonly spans: TraceDerivationSpanReaderPort) {}

  derive(input: {
    projectId: string;
    traceId: string;
    occurredAtMs?: number;
    foldVersion?: number;
  }): Promise<DerivedTraceEvent[]> {
    const read = () =>
      this.spans.findDerivedEventsByTraceId({
        tenantId: input.projectId,
        traceId: input.traceId,
        ...(input.occurredAtMs === undefined ? {} : { occurredAtMs: input.occurredAtMs }),
      });
    if (input.foldVersion === undefined) return read();

    const key = `${input.projectId}:${input.traceId}:${input.foldVersion}`;
    const now = Date.now();
    const hit = this.memo.get(key);
    if (hit && hit.expiresAt > now) return hit.value;

    const value = read();
    // Delete before set so a refreshed key re-inserts at the end: `Map.set` on
    // an existing key keeps its original position, and eviction would then drop
    // the entry that was just read as the "oldest".
    this.memo.delete(key);
    // The window starts when the read RESOLVES, not when it is issued. Stamping
    // it up front lets a read slower than the window expire mid-flight, so
    // concurrent callers miss the memo and fire duplicates — exactly on the
    // slow heavy-trace reads this exists for.
    const entry: MemoEntry = { value, expiresAt: Number.POSITIVE_INFINITY };
    this.memo.set(key, entry);
    value.then(
      () => {
        entry.expiresAt = Date.now() + EVENT_DERIVATION_WINDOW_MS;
      },
      // Never cache a failure: drop it so the next caller retries the read
      // rather than replaying the rejection.
      () => {
        if (this.memo.get(key) === entry) this.memo.delete(key);
      },
    );
    this.evict(now);

    return value;
  }

  private evict(now: number): void {
    for (const [key, entry] of this.memo) {
      if (entry.expiresAt > now) break;
      this.memo.delete(key);
    }
    while (this.memo.size > EVENT_DERIVATION_MEMO_MAX_ENTRIES) {
      const oldest = this.memo.keys().next().value;
      if (oldest === undefined) break;
      this.memo.delete(oldest);
    }
  }
}
