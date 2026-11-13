import type { TraceAgentSeen } from "@langwatch/trace-contract";

import { TraceAgentTrafficRepository } from "../trace-agent-traffic.repository.ts";

type RecordedAgentSpan = {
  tenantId: string;
  startTimeMs: number;
  agentName: string;
  agentId?: string;
  model?: string;
};

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
    const byName = new Map<string, TraceAgentSeen>();
    for (const span of this.#spans) {
      if (span.tenantId !== input.tenantId || span.startTimeMs < input.sinceMs) continue;
      if (span.agentName === "") continue;
      const seen = byName.get(span.agentName) ?? {
        agentName: span.agentName,
        agentId: null,
        model: null,
        spanCount: 0,
        firstSeenMs: span.startTimeMs,
        lastSeenMs: span.startTimeMs,
      };
      byName.set(span.agentName, {
        ...seen,
        agentId: seen.agentId ?? span.agentId ?? null,
        model: seen.model ?? span.model ?? null,
        spanCount: seen.spanCount + 1,
        firstSeenMs: Math.min(seen.firstSeenMs, span.startTimeMs),
        lastSeenMs: Math.max(seen.lastSeenMs, span.startTimeMs),
      });
    }
    return [...byName.values()]
      .toSorted((a, b) => b.spanCount - a.spanCount || a.agentName.localeCompare(b.agentName))
      .slice(0, input.limit);
  }
}
