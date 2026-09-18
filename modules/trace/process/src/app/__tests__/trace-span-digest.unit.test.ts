import { createApiFixture } from "@langwatch/api-fixture";
import type { Span, TraceApi } from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";

import { TraceApp, type TraceAppDependencies } from "../trace.app.ts";
import type { TraceLegacyRead } from "../trace.members.ts";

function createTraceApp(): TraceApi {
  return TraceApp.create(
    createApiFixture<TraceAppDependencies>({
      traces: createApiFixture<TraceAppDependencies["traces"]>({
        read: createApiFixture<TraceLegacyRead>(),
      }),
    }),
  );
}

describe("TraceApi.formatSpansDigest", () => {
  /** @scenario "Evaluation digests retain captured span content and timing" */
  it("renders the captured input and output with the span duration", async () => {
    const span: Span = {
      span_id: "span-1",
      trace_id: "trace-1",
      type: "span",
      name: "answer-question",
      timestamps: { started_at: 1000, finished_at: 1250 },
      input: { type: "text", value: "What is the capital of France?" },
      output: { type: "text", value: "Paris" },
    };
    const original = structuredClone(span);

    const digest = await createTraceApp().formatSpansDigest({ spans: [span] });

    expect(digest).toContain("Spans: 1");
    expect(digest).toContain("250ms");
    expect(digest).toContain("answer-question");
    expect(digest).toContain("What is the capital of France?");
    expect(digest).toContain("Paris");
    expect(span).toEqual(original);
  });

  /** @scenario "An empty evaluation trace has the canonical empty digest" */
  it("renders an empty trace without fabricating a span", async () => {
    await expect(createTraceApp().formatSpansDigest({ spans: [] })).resolves.toBe(
      "No spans recorded.",
    );
  });
});
