import {
  TraceQueryFieldValuesPort,
  type TraceQueryFieldValuesInput,
  type TraceQueryFieldValuesResult,
} from "@langwatch/trace-server";

import type { TraceListService } from "~/server/app-layer/traces/trace-list.service";

/** Adapts the legacy Trace list read until its repository joins Trace server. */
export class AppTraceQueryFieldValuesAdapter extends TraceQueryFieldValuesPort {
  private constructor(private readonly traces: TraceListService) {
    super();
  }

  static create(traces: TraceListService): AppTraceQueryFieldValuesAdapter {
    return new AppTraceQueryFieldValuesAdapter(traces);
  }

  async list(input: TraceQueryFieldValuesInput): Promise<TraceQueryFieldValuesResult> {
    return this.traces.getFacetValues({
      tenantId: input.projectId,
      timeRange: input.timeRange,
      facetKey: input.facetKey,
      limit: input.limit,
      offset: input.offset,
    });
  }
}
