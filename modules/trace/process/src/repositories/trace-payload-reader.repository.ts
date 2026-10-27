import { createLogger } from "@langwatch/observability";

import {
  type OffloadedFieldReference,
  offloadedFieldKey,
} from "../rules/trace-offload-recall.rules.ts";

const logger = createLogger("langwatch:traces:offload-recall");

/**
 * Event reads in flight at once across one recall. Each read parses a whole span event, so the
 * pool, not the number of references, bounds what a recall holds while it reads.
 */
export const OFFLOAD_RECALL_CONCURRENCY = 25;

/**
 * Offloaded bytes one trace may bring back in a single read; past it the rest keep their 64 KB
 * previews. Evaluations of a trace whose spans each carried a multi-megabyte conversation
 * exhausted the heap of every worker that took them, where the previews would have served.
 */
export const OFFLOAD_RECALL_TRACE_BUDGET_BYTES = 32 * 1024 * 1024;

/** Offloaded bytes one recall may bring back across all its traces: a page of heavy traces. */
export const OFFLOAD_RECALL_TOTAL_BUDGET_BYTES = 256 * 1024 * 1024;

export type OffloadRecallOutcome = { ok: true; value: string } | { ok: false; error: unknown };

/** The event was read, but it carries no such field: a corrupted event or a stale reference. */
export class TraceEventPayloadFieldNotFoundError extends Error {
  constructor(
    readonly eventId: string,
    readonly field: string,
  ) {
    super(`Field "${field}" not found in the payload of event ${eventId}`);
    this.name = "TraceEventPayloadFieldNotFoundError";
  }
}

/** The field was left at its preview because its trace had spent its recall budget. */
export class TraceOffloadBudgetExceededError extends Error {
  constructor(
    readonly traceId: string,
    readonly budgetBytes: number,
  ) {
    super(`Trace ${traceId} spent its ${budgetBytes}-byte offload recall budget`);
    this.name = "TraceOffloadBudgetExceededError";
  }
}

type EventRead = { traceId: string; eventId: string; fields: Set<string> };

/** External claim-check payload reads for internal Trace full-record reads. */
export abstract class TracePayloadReaderRepository {
  /**
   * The asked fields of one trace event, from ONE read of it: the event is the whole span, so a
   * read per field multiplied the bytes parsed. A field the event lacks is absent from the map; a
   * read that cannot be served raises, and the caller keeps the preview.
   */
  abstract readFields(input: {
    tenantId: string;
    traceId: string;
    eventId: string;
    fields: readonly string[];
  }): Promise<ReadonlyMap<string, string>>;

  /**
   * Offloaded fields for every full-value read path (ADR-022): one read per event, a bounded pool,
   * byte budgets per trace and per recall past which previews stay. Never throws: each reference
   * answers, keyed by `offloadedFieldKey`, with its value or the error that kept its preview.
   */
  async recall({
    tenantId,
    references,
    concurrency = OFFLOAD_RECALL_CONCURRENCY,
    traceBudgetBytes = OFFLOAD_RECALL_TRACE_BUDGET_BYTES,
    totalBudgetBytes = OFFLOAD_RECALL_TOTAL_BUDGET_BYTES,
  }: {
    tenantId: string;
    references: readonly OffloadedFieldReference[];
    concurrency?: number;
    traceBudgetBytes?: number;
    totalBudgetBytes?: number;
  }): Promise<Map<string, OffloadRecallOutcome>> {
    const reads = TracePayloadReaderRepository.groupByEvent(references);
    const outcomes = new Map<string, OffloadRecallOutcome>();
    const spentByTrace = new Map<string, number>();
    let spentTotal = 0;
    const overBudget = new Set<string>();

    // The budget a trace has run out of, or null while it may still read. Checked before a read
    // starts and again when it lands: reads in flight together all start under budget, so one
    // landing after the budget is spent is dropped rather than kept.
    const spentBudget = (traceId: string): number | null => {
      if ((spentByTrace.get(traceId) ?? 0) >= traceBudgetBytes) return traceBudgetBytes;
      if (spentTotal >= totalBudgetBytes) return totalBudgetBytes;
      return null;
    };
    const keepPreviews = (read: EventRead, budgetBytes: number): void => {
      TracePayloadReaderRepository.settleAll(read, outcomes, {
        ok: false,
        error: new TraceOffloadBudgetExceededError(read.traceId, budgetBytes),
      });
      if (overBudget.has(read.traceId)) return;
      overBudget.add(read.traceId);
      logger.warn(
        { tenantId, traceId: read.traceId, budgetBytes, spentTotalBytes: spentTotal },
        "Offload recall budget spent; the rest of this trace's offloaded fields keep their previews",
      );
    };

    const readOne = async (read: EventRead): Promise<void> => {
      const before = spentBudget(read.traceId);
      if (before !== null) return keepPreviews(read, before);

      let values: ReadonlyMap<string, string>;
      try {
        values = await this.readFields({
          tenantId,
          traceId: read.traceId,
          eventId: read.eventId,
          fields: [...read.fields],
        });
      } catch (error) {
        TracePayloadReaderRepository.settleAll(read, outcomes, { ok: false, error });
        return;
      }

      const after = spentBudget(read.traceId);
      if (after !== null) return keepPreviews(read, after);

      const bytes = TracePayloadReaderRepository.settleValues(read, values, outcomes);
      spentByTrace.set(read.traceId, (spentByTrace.get(read.traceId) ?? 0) + bytes);
      spentTotal += bytes;
    };

    await TracePayloadReaderRepository.inPool([...reads.values()], concurrency, readOne);
    return outcomes;
  }

  /** The references collapsed to one read per trace event, in first-seen order. */
  private static groupByEvent(
    references: readonly OffloadedFieldReference[],
  ): Map<string, EventRead> {
    const reads = new Map<string, EventRead>();
    for (const { traceId, eventId, field } of references) {
      const eventKey = `${traceId}\u0000${eventId}`;
      const read = reads.get(eventKey);
      if (read) {
        read.fields.add(field);
      } else {
        reads.set(eventKey, { traceId, eventId, fields: new Set([field]) });
      }
    }
    return reads;
  }

  /** Each field's value, or why the event lacked it; answers the bytes the values hold. */
  private static settleValues(
    read: EventRead,
    values: ReadonlyMap<string, string>,
    outcomes: Map<string, OffloadRecallOutcome>,
  ): number {
    let bytes = 0;
    for (const field of read.fields) {
      const key = offloadedFieldKey({ traceId: read.traceId, eventId: read.eventId, field });
      const value = values.get(field);
      if (value === undefined) {
        const error = new TraceEventPayloadFieldNotFoundError(read.eventId, field);
        outcomes.set(key, { ok: false, error });
        continue;
      }
      bytes += Buffer.byteLength(value, "utf8");
      outcomes.set(key, { ok: true, value });
    }
    return bytes;
  }

  private static settleAll(
    read: EventRead,
    outcomes: Map<string, OffloadRecallOutcome>,
    outcome: OffloadRecallOutcome,
  ): void {
    for (const field of read.fields) {
      outcomes.set(
        offloadedFieldKey({ traceId: read.traceId, eventId: read.eventId, field }),
        outcome,
      );
    }
  }

  /** At most `concurrency` operations in flight, taken in input order. */
  private static async inPool<Item>(
    items: readonly Item[],
    concurrency: number,
    operation: (item: Item) => Promise<void>,
  ): Promise<void> {
    let next = 0;
    const lanes = Array.from(
      { length: Math.min(Math.max(1, concurrency), items.length) },
      async () => {
        while (next < items.length) {
          const item = items[next++] as Item;
          await operation(item);
        }
      },
    );
    await Promise.all(lanes);
  }
}
