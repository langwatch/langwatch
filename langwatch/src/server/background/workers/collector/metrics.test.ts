import { describe, it, expect } from "vitest";
import type { Span } from "../../../tracer/types";
import { addLLMTokensCount } from "./metrics";

describe("Trace metrics", () => {
  it.skip("calculates cost correctly when number of tokens is available", async () => {
    const spans: Span[] = [
      {
        trace_id: "trace_1",
        span_id: "span_1",
        type: "llm",
        model: "gpt-4o-mini",
        input: {
          type: "text",
          value: "Hello, world!",
        },
        output: {
          type: "text",
          value: "Hello, world!",
        },
        timestamps: {
          started_at: Date.now(),
          finished_at: Date.now() + 1000,
        },
        metrics: {
          prompt_tokens: 200,
          completion_tokens: 100,
        },
      },
    ];

    const [span] = await addLLMTokensCount("project_abc", spans);

    const gpt4oMiniInputCost = 0.00000015;
    const gpt4oMiniOutputCost = 0.0000006;

    expect(span).toBeTruthy();
    expect(span!.metrics).toBeTruthy();
    expect(span!.metrics!.cost).toEqual(
      gpt4oMiniInputCost * 200 + gpt4oMiniOutputCost * 100
    );
  });
});
