import { TraceService } from "@langwatch/trace-contract";
import { describe, expect, it, vi } from "vitest";
import { AutomationEvaluationTriggerFilterService } from "../automation-evaluation-trigger-filter.service";

class TestTraceService extends TraceService {
  readonly classify = vi.fn((_input: { query: string }) => ({
    evaluations: true,
    events: false,
    spans: false,
  }));

  classifyQuery(input: { query: string }) {
    return this.classify(input);
  }

  getById(): Promise<never> {
    return Promise.reject(new Error("unused trace capability"));
  }

  deriveEvents(): Promise<never> {
    return Promise.reject(new Error("unused trace capability"));
  }

  getEvaluationSpans(): Promise<never> {
    return Promise.reject(new Error("unused trace capability"));
  }

  getEvaluationEvents(): Promise<never> {
    return Promise.reject(new Error("unused trace capability"));
  }

  getSpanTreePage(): Promise<never> {
    return Promise.reject(new Error("unused trace capability"));
  }

  getSpanTreeDelta(): Promise<never> {
    return Promise.reject(new Error("unused trace capability"));
  }

  buildQueryFieldCatalogue(): Promise<never> {
    return Promise.reject(new Error("unused trace capability"));
  }

  resolveIngestWaitTimeout(): Promise<never> {
    return Promise.reject(new Error("unused trace capability"));
  }

  tryGetSummary(): Promise<null> {
    return Promise.resolve(null);
  }
}

describe("AutomationEvaluationTriggerFilterService", () => {
  it("delegates Liqe query classification to the complete Trace service", () => {
    const traces = new TestTraceService();
    const filter = AutomationEvaluationTriggerFilterService.create(traces);

    expect(filter.readsEvaluations({ filters: {}, filterQuery: "has:eval" })).toBe(true);
    expect(traces.classify).toHaveBeenCalledWith({ query: "has:eval" });
  });

  it("keeps legacy structured-filter classification local", () => {
    const traces = new TestTraceService();
    const filter = AutomationEvaluationTriggerFilterService.create(traces);

    expect(
      filter.readsEvaluations({
        filters: { "evaluations.evaluator_id": ["evaluator-1"] },
        filterQuery: null,
      }),
    ).toBe(true);
    expect(traces.classify).not.toHaveBeenCalled();
  });
});
