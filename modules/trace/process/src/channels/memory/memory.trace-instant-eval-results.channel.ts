import type { InstantEvalTraceResultWire } from "@langwatch/instant-eval-contract";

import type { TraceInstantEvalResults } from "../trace-instant-eval-results.channel.ts";

/** Instant-eval's kept results as a test scripts them, for a process without instant-eval. */
export class MemoryTraceInstantEvalResultsChannel implements TraceInstantEvalResults {
  readonly results: (InstantEvalTraceResultWire & { tenantId: string; traceId: string })[] = [];

  static create(): MemoryTraceInstantEvalResultsChannel {
    return new MemoryTraceInstantEvalResultsChannel();
  }

  private constructor() {}

  async findResultsByTrace(input: {
    projectId: string;
    traceId: string;
    occurredFrom: number;
    occurredUntil: number;
  }): Promise<InstantEvalTraceResultWire[]> {
    return this.results
      .filter((result) => result.tenantId === input.projectId && result.traceId === input.traceId)
      .map(({ tenantId: _tenantId, traceId: _traceId, ...result }) => result);
  }
}
