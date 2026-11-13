import type { TraceAgentSeen } from "@langwatch/trace-contract";

import { TraceAgentTrafficRepository } from "../trace-agent-traffic.repository.ts";

type RecordedAgentSpan = {
  tenantId: string;
  startTimeMs: number;
  agentName: string;
  agentId?: string;
  model?: string;
};

/** Non-empty values latest first by start time, ties by the greater value, as ClickHouse picks. */
function latestFirst(
  spans: readonly RecordedAgentSpan[],
  valueOf: (span: RecordedAgentSpan) => string | undefined,
): string[] {
  return spans
    .flatMap((span) => {
      const value = valueOf(span);
      return value ? [{ at: span.startTimeMs, value }] : [];
    })
    .toSorted((a, b) => b.at - a.at || Number(b.value > a.value) - Number(b.value < a.value))
    .map(({ value }) => value);
}

/** In-memory twin of the agent traffic read, exact over the spans a test records. */
export class MemoryTraceAgentTrafficRepository extends TraceAgentTrafficRepository {
  readonly #spans: RecordedAgentSpan[] = [];

  static create(): MemoryTraceAgentTrafficRepository {
    return new MemoryTraceAgentTrafficRepository();
  }

  private constructor() {
    super();
  }

  record(span: RecordedAgentSpan): void {
    this.#spans.push(span);
  }

  async findAgentsSeen(input: {
    tenantId: string;
    sinceMs: number;
    limit: number;
  }): Promise<TraceAgentSeen[]> {
    const byName = new Map<string, RecordedAgentSpan[]>();
    for (const span of this.#spans) {
      if (span.tenantId !== input.tenantId || span.startTimeMs < input.sinceMs) continue;
      if (span.agentName === "") continue;
      byName.set(span.agentName, [...(byName.get(span.agentName) ?? []), span]);
    }
    return [...byName.entries()]
      .map(([agentName, spans]) => ({
        agentName,
        agentId: latestFirst(spans, (span) => span.agentId)[0] ?? null,
        model: latestFirst(spans, (span) => span.model)[0] ?? null,
        spanCount: spans.length,
        firstSeenMs: Math.min(...spans.map((span) => span.startTimeMs)),
        lastSeenMs: Math.max(...spans.map((span) => span.startTimeMs)),
      }))
      .toSorted((a, b) => b.spanCount - a.spanCount || a.agentName.localeCompare(b.agentName))
      .slice(0, input.limit);
  }
}
