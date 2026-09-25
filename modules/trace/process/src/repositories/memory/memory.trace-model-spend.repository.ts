import type { TraceModelSpend, TraceModelSpendWindow } from "@langwatch/trace-contract";

import { TraceModelSpendRepository } from "../trace-model-spend.repository.ts";

type SpentTrace = Readonly<{
  tenantId: string;
  occurredAtMs: number;
  models: readonly string[];
  spentUsd: number;
  nonBilledUsd: number;
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
    for (const trace of this.#traces) {
      if (trace.tenantId !== input.tenantId) continue;
      if (trace.occurredAtMs < input.window.startMs || trace.occurredAtMs >= input.window.endMs) {
        continue;
      }
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
}
