import { Temporal } from "@langwatch/time";
import type {
  TraceDailySpend,
  TraceModelRequests,
  TraceModelSpend,
  TraceModelSpendWindow,
  TraceSpendSummary,
} from "@langwatch/trace-contract";

import { TraceModelSpendRepository } from "../trace-model-spend.repository.ts";

type SpentTrace = Readonly<{
  tenantId: string;
  occurredAtMs: number;
  models: readonly string[];
  spentUsd: number;
  nonBilledUsd: number;
  promptTokens?: number;
  completionTokens?: number;
}>;

/**
 * Main's attribution-by-presence over seeded traces: each model a trace used takes its whole
 * cost.
 */
export class MemoryTraceModelSpendRepository extends TraceModelSpendRepository {
  readonly #traces: SpentTrace[] = [];

  static create(): MemoryTraceModelSpendRepository {
    return new MemoryTraceModelSpendRepository();
  }

  private constructor() {
    super();
  }

  record(trace: SpentTrace): void {
    this.#traces.push(trace);
  }

  async findModelSpend(input: {
    tenantId: string;
    window: TraceModelSpendWindow;
    limit: number;
  }): Promise<TraceModelSpend[]> {
    const byModel = new Map<string, TraceModelSpend>();
    for (const trace of this.#inWindow(input)) {
      for (const label of trace.models) {
        const sum = byModel.get(label) ?? { label, spentUsd: 0, billedUsd: 0, requests: 0 };
        byModel.set(label, {
          label,
          spentUsd: sum.spentUsd + trace.spentUsd,
          billedUsd: sum.billedUsd + trace.spentUsd - trace.nonBilledUsd,
          requests: sum.requests + 1,
        });
      }
    }

    return [...byModel.values()].toSorted((a, b) => b.spentUsd - a.spentUsd).slice(0, input.limit);
  }

  async getSpendSummary(input: {
    tenantId: string;
    window: TraceModelSpendWindow;
  }): Promise<TraceSpendSummary> {
    const traces = this.#inWindow(input);
    return {
      totalCost: traces.reduce((sum, trace) => sum + trace.spentUsd, 0),
      billedCost: traces.reduce((sum, trace) => sum + trace.spentUsd - trace.nonBilledUsd, 0),
      requestCount: traces.length,
      promptTokens: traces.reduce((sum, trace) => sum + (trace.promptTokens ?? 0), 0),
      completionTokens: traces.reduce((sum, trace) => sum + (trace.completionTokens ?? 0), 0),
    };
  }

  async findTopModelsByRequests(input: {
    tenantId: string;
    window: TraceModelSpendWindow;
    limit: number;
  }): Promise<TraceModelRequests[]> {
    const byModel = new Map<string, number>();
    for (const trace of this.#inWindow(input)) {
      for (const model of trace.models) byModel.set(model, (byModel.get(model) ?? 0) + 1);
    }

    return [...byModel.entries()]
      .map(([model, requests]) => ({ model, requests }))
      .toSorted((a, b) => b.requests - a.requests)
      .slice(0, input.limit);
  }

  async findDailySpend(input: {
    tenantId: string;
    window: TraceModelSpendWindow;
  }): Promise<TraceDailySpend[]> {
    const byDay = new Map<string, TraceDailySpend>();
    for (const trace of this.#inWindow(input)) {
      const day = Temporal.Instant.fromEpochMilliseconds(trace.occurredAtMs)
        .toZonedDateTimeISO("UTC")
        .toPlainDate()
        .toString();
      const sum = byDay.get(day) ?? { day, spentUsd: 0, billedUsd: 0, requests: 0 };
      byDay.set(day, {
        day,
        spentUsd: sum.spentUsd + trace.spentUsd,
        billedUsd: sum.billedUsd + trace.spentUsd - trace.nonBilledUsd,
        requests: sum.requests + 1,
      });
    }

    return [...byDay.values()].toSorted((a, b) => a.day.localeCompare(b.day));
  }

  #inWindow(input: { tenantId: string; window: TraceModelSpendWindow }): SpentTrace[] {
    return this.#traces.filter(
      (trace) =>
        trace.tenantId === input.tenantId &&
        trace.occurredAtMs >= input.window.startMs &&
        trace.occurredAtMs < input.window.endMs,
    );
  }
}
