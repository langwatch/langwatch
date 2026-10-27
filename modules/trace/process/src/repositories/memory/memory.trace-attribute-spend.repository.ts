import { Temporal } from "@langwatch/time";
import type {
  TraceAttributedTrace,
  TraceAttributeUsageBucket,
  TraceAttributeValueSpend,
  TraceModelSpendWindow,
} from "@langwatch/trace-contract";

import { TraceAttributeSpendRepository } from "../trace-attribute-spend.repository.ts";

type AttributedTrace = Readonly<{
  tenantId: string;
  traceId: string;
  occurredAtMs: number;
  attributes: Readonly<Record<string, string>>;
  costUsd: number;
  models?: readonly string[];
  promptTokens?: number;
  completionTokens?: number;
  durationMs?: number;
  hasError?: boolean;
  blockedByGuardrail?: boolean;
}>;

type Filter = {
  tenantId: string;
  attributeKey: string;
  window: TraceModelSpendWindow;
  values?: string[];
};

/** The latest version of each seeded trace, filtered and grouped as the ClickHouse reads do. */
export class MemoryTraceAttributeSpendRepository extends TraceAttributeSpendRepository {
  readonly #traces = new Map<string, AttributedTrace>();

  static create(): MemoryTraceAttributeSpendRepository {
    return new MemoryTraceAttributeSpendRepository();
  }

  private constructor() {
    super();
  }

  record(trace: AttributedTrace): void {
    this.#traces.set(`${trace.tenantId}/${trace.traceId}`, trace);
  }

  async findSpendByAttributeValue(
    input: Filter & { values: string[] },
  ): Promise<TraceAttributeValueSpend[]> {
    const byValue = new Map<string, { spent: number; requests: number }>();
    for (const trace of this.#matching(input)) {
      const value = trace.attributes[input.attributeKey] ?? "";
      const sum = byValue.get(value) ?? { spent: 0, requests: 0 };
      byValue.set(value, { spent: sum.spent + trace.costUsd, requests: sum.requests + 1 });
    }
    return [...byValue].map(([value, sum]) => ({
      value,
      spentUsd: String(sum.spent),
      requests: sum.requests,
    }));
  }

  async findAttributeUsageBuckets(input: Filter): Promise<TraceAttributeUsageBucket[]> {
    const buckets = new Map<string, TraceAttributeUsageBucket & { spent: number }>();
    for (const trace of this.#matching(input)) {
      const value = trace.attributes[input.attributeKey] ?? "";
      const model = firstModel(trace);
      const day = Temporal.Instant.fromEpochMilliseconds(trace.occurredAtMs)
        .toString()
        .slice(0, 10);
      const key = `${value}\u0000${model}\u0000${day}`;
      const sum = buckets.get(key) ?? {
        value,
        model,
        day,
        totalUsd: "0",
        requests: 0,
        blockedRequests: 0,
        spent: 0,
      };
      const spent = sum.spent + trace.costUsd;
      buckets.set(key, {
        ...sum,
        spent,
        totalUsd: String(spent),
        requests: sum.requests + 1,
        blockedRequests: sum.blockedRequests + (trace.blockedByGuardrail ? 1 : 0),
      });
    }
    return [...buckets.values()].map(({ spent: _spent, ...bucket }) => bucket);
  }

  async findAttributedTraces(
    input: Filter & { model?: string; limit: number },
  ): Promise<TraceAttributedTrace[]> {
    return this.#matching(input)
      .filter((trace) => !input.model || firstModel(trace) === input.model)
      .toSorted((a, b) => b.occurredAtMs - a.occurredAtMs)
      .slice(0, Math.max(1, Math.floor(input.limit)))
      .map((trace) => ({
        traceId: trace.traceId,
        value: trace.attributes[input.attributeKey] ?? "",
        costUsd: String(trace.costUsd),
        models: trace.models ?? [],
        occurredAtMs: trace.occurredAtMs,
        promptTokens: trace.promptTokens ?? 0,
        completionTokens: trace.completionTokens ?? 0,
        durationMs: trace.durationMs ?? 0,
        hasError: trace.hasError ?? false,
        blockedByGuardrail: trace.blockedByGuardrail ?? false,
      }));
  }

  #matching(input: Filter): AttributedTrace[] {
    if (input.values?.length === 0) return [];
    return [...this.#traces.values()].filter((trace) => {
      const value = trace.attributes[input.attributeKey] ?? "";
      return (
        trace.tenantId === input.tenantId &&
        trace.occurredAtMs >= input.window.startMs &&
        trace.occurredAtMs < input.window.endMs &&
        (input.values ? input.values.includes(value) : value !== "")
      );
    });
  }
}

function firstModel(trace: AttributedTrace): string {
  return trace.models?.[0] ?? "unknown";
}
