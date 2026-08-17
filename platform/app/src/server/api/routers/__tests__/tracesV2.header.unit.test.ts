import { describe, expect, it } from "vitest";
import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import { mapTraceSummaryToHeader } from "../tracesV2";

describe("mapTraceSummaryToHeader", () => {
  it("keeps token-accumulation controls out of public attributes", () => {
    const summary = {
      traceId: "trace-1",
      occurredAt: 1_000,
      attributes: {
        "metadata.customer": "kept",
        "langwatch.reserved.token_accumulation_candidate": "true",
        "langwatch.reserved.token_accumulation_authority": "true",
        "langwatch.reserved.token_accumulation_candidate_totals": "{}",
        "langwatch.reserved.token_accumulation_authority_totals": "{}",
      },
      totalDurationMs: 100,
      spanCount: 2,
      containsErrorStatus: false,
      containsOKStatus: true,
      errorMessage: null,
      computedInput: null,
      computedOutput: null,
      models: [],
      totalCost: null,
      nonBilledCost: null,
      totalPromptTokenCount: 10,
      totalCompletionTokenCount: 2,
      tokensEstimated: false,
      timeToFirstTokenMs: null,
    } as TraceSummaryData;

    expect(mapTraceSummaryToHeader(summary).attributes).toEqual({
      "metadata.customer": "kept",
    });
  });
});
