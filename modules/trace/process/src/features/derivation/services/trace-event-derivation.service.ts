import type { Authorization } from "@langwatch/authorization";
import { ownProjectIdOf, tenantScopeKey } from "@langwatch/clickhouse-client";
import type { FoldReadAuthorizer } from "@langwatch/eventing";
import { nowInstant } from "@langwatch/time";
import type { DerivedTraceEvent, TraceDerivedEventsInput } from "@langwatch/trace-contract";

import type { TraceDerivationSpanReaderRepository } from "../../../repositories/trace-derivation-span-reader.repository.ts";

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
 * A trace's span events, read once per fold version. A coalesced fold batch dispatches subscribers
 * once per event at one shared final state, so a per-subscriber read would re-saturate ClickHouse
 * during a drain. With no `foldVersion` the read passes straight through, never cached.
 */
export class TraceEventDerivationService {
  static create(options: {
    spans: TraceDerivationSpanReaderRepository;
    authorize: FoldReadAuthorizer;
  }): TraceEventDerivationService {
    return new TraceEventDerivationService(options.spans, options.authorize);
  }

  private readonly memo = new Map<string, MemoEntry>();

  private constructor(
    private readonly spans: TraceDerivationSpanReaderRepository,
    private readonly authorize: FoldReadAuthorizer,
  ) {}

  async derive({ projectId, ...input }: TraceDerivedEventsInput): Promise<DerivedTraceEvent[]> {
    const authorization = await this.authorize({
      projectId,
      purpose: { kind: "operator", entry: "TraceEventDerivationService.derive" },
    });
    return this.deriveFor({ authorization, ...input });
  }

  /** Keyed on the fence the proof allows, so an aggregate never shares an entry with a member. */
  deriveFor(input: {
    authorization: Authorization;
    traceId: string;
    occurredAtMs?: number | undefined;
    foldVersion?: number | undefined;
  }): Promise<DerivedTraceEvent[]> {
    const read = () =>
      this.spans.findDerivedEventsByTraceId({
        // shortcut: the derivation reader still filters one TenantId, so a read takes the proof's
        // own project; fence it through AuthorizedClickHouse once an aggregate derives events.
        tenantId: ownProjectIdOf({ authorization: input.authorization, reads: "traces" }),
        traceId: input.traceId,
        ...(input.occurredAtMs === undefined ? {} : { occurredAtMs: input.occurredAtMs }),
      });
    if (input.foldVersion === undefined) {
      return read();
    }

    const scope = tenantScopeKey({ authorization: input.authorization, reads: "traces" });
    const key = `${scope}:${input.traceId}:${input.foldVersion}`;
    const now = nowInstant().epochMilliseconds;
    const hit = this.memo.get(key);
    if (hit && hit.expiresAt > now) {
      return hit.value;
    }

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
    value
      .then(() => {
        entry.expiresAt = nowInstant().epochMilliseconds + EVENT_DERIVATION_WINDOW_MS;
      })
      .catch(
        // Never cache a failure: drop it so the next caller retries the read
        // rather than replaying the rejection.
        () => {
          if (this.memo.get(key) === entry) {
            this.memo.delete(key);
          }
        },
      );
    this.evict(now);

    return value;
  }

  private evict(now: number): void {
    for (const [key, entry] of this.memo) {
      if (entry.expiresAt > now) {
        break;
      }

      this.memo.delete(key);
    }

    while (this.memo.size > EVENT_DERIVATION_MEMO_MAX_ENTRIES) {
      const oldest = this.memo.keys().next().value;
      if (oldest === undefined) {
        break;
      }

      this.memo.delete(oldest);
    }
  }
}
