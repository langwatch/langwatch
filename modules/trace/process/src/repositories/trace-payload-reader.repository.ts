import { pMapLimited } from "@langwatch/eventing";
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

/** Whose budget ran out: the trace's own, or the whole recall's across its traces. */
export type OffloadRecallBudgetScope = "trace" | "recall";

/** The field was left at its preview because a recall budget was spent. */
export class TraceOffloadBudgetExceededError extends Error {
  readonly traceId: string;
  readonly budgetBytes: number;
  readonly scope: OffloadRecallBudgetScope;

  constructor({
    traceId,
    budgetBytes,
    scope,
  }: {
    traceId: string;
    budgetBytes: number;
    scope: OffloadRecallBudgetScope;
  }) {
    super(
      scope === "trace"
        ? `Trace ${traceId} spent its ${budgetBytes}-byte offload recall budget`
        : `The recall spent its ${budgetBytes}-byte budget before trace ${traceId} was read`,
    );
    this.name = "TraceOffloadBudgetExceededError";
    this.traceId = traceId;
    this.budgetBytes = budgetBytes;
    this.scope = scope;
  }
}

type SpentBudget = { scope: OffloadRecallBudgetScope; budgetBytes: number };

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
    const warned = new Set<string>();

    // The budget a trace has run out of, or null while it may still read. Checked before a read
    // starts and again when it lands: reads in flight together all start under budget, so one
    // landing after the budget is spent is dropped rather than kept.
    const spentBudget = (traceId: string): SpentBudget | null =>
      TracePayloadReaderRepository.spentBudget({
        traceBytes: spentByTrace.get(traceId) ?? 0,
        totalBytes: spentTotal,
        traceBudgetBytes,
        totalBudgetBytes,
      });
    const keepPreviews = (read: EventRead, spent: SpentBudget): void => {
      TracePayloadReaderRepository.settleAll(read, outcomes, {
        ok: false,
        error: new TraceOffloadBudgetExceededError({ traceId: read.traceId, ...spent }),
      });
      const warning = TracePayloadReaderRepository.budgetWarning(read.traceId, spent);
      if (warned.has(warning.key)) return;
      warned.add(warning.key);
      logger.warn(
        { tenantId, traceId: read.traceId, ...spent, spentTotalBytes: spentTotal },
        warning.message,
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

    await pMapLimited({
      items: [...reads.values()],
      fn: readOne,
      concurrency: Math.max(1, concurrency),
    });
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

  /** The budget a trace has run out of, its own before the recall's, or null while it may read. */
  private static spentBudget({
    traceBytes,
    totalBytes,
    traceBudgetBytes,
    totalBudgetBytes,
  }: {
    traceBytes: number;
    totalBytes: number;
    traceBudgetBytes: number;
    totalBudgetBytes: number;
  }): SpentBudget | null {
    if (traceBytes >= traceBudgetBytes) return { scope: "trace", budgetBytes: traceBudgetBytes };
    if (totalBytes >= totalBudgetBytes) return { scope: "recall", budgetBytes: totalBudgetBytes };
    return null;
  }

  /** One warning per trace for its own budget, and one per recall once the recall's runs out. */
  private static budgetWarning(
    traceId: string,
    spent: SpentBudget,
  ): { key: string; message: string } {
    if (spent.scope === "trace") {
      return {
        key: `trace:${traceId}`,
        message:
          "Offload recall budget spent; the rest of this trace's offloaded fields keep their previews",
      };
    }
    return {
      key: "recall",
      message:
        "Offload recall budget spent across its traces; the traces not yet read keep their previews",
    };
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
}
