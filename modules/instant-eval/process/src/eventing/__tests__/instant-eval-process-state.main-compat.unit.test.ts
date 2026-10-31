import type { InstantEvalProcessingEvent } from "@langwatch/instant-eval-contract";
import { describe, expect, it } from "vitest";

import {
  instantEvalProcessEventViewSchema,
  instantEvalProcessStateSchema,
} from "../instant-eval-processing-data.process.ts";
import {
  buildInstantEvalProcessEventView,
  handleInstantEvalPageJudged,
} from "../instant-eval-processing-evolution.process.ts";
import { context, running } from "./instant-eval-process.fixtures.ts";

describe("process state stored by the main release", () => {
  it("parses an instant evaluation state as main stored it", () => {
    expect(
      instantEvalProcessStateSchema.parse({
        phase: "running",
        page: 2,
        cursor: "trace_1",
        cursorSpanId: null,
        pageSize: 50,
        keyColumns: ["trace_id"],
        remaining: 10,
        inputTokens: 100,
        requests: 2,
        lastActivityAtMs: 1,
        cancelRequestedAtMs: null,
      }),
    ).toEqual({
      phase: "running",
      page: 2,
      cursor: "trace_1",
      cursorSpanId: null,
      pageSize: 50,
      keyColumns: ["trace_id"],
      remaining: 10,
      inputTokens: 100,
      requests: 2,
      costNanoUsd: 0,
      routedInputTokens: 0,
      lastActivityAtMs: 1,
      cancelRequestedAtMs: null,
      isFinishRecorded: false,
      unbilledLatePages: [],
      lateHoldUntilMs: null,
    });
  });
});

describe("a page_judged event stored by the main release, folded on replay", () => {
  /** @scenario "A page event without a routed cost still reads and prices from tokens" */
  it("reads its missing routed cost and routed tokens as zero, never NaN", () => {
    const stored = {
      aggregateId: "instanteval_1",
      type: "lw.obs.instant_eval.page_judged",
      data: { runId: "instanteval_1", page: 2, rows: 5, inputTokens: 200, requests: 5 },
    };
    // wrong-typed input: replay hands the fold unparsed JSON, and main wrote no routed field.
    const event = stored as unknown as InstantEvalProcessingEvent;
    const payload = instantEvalProcessEventViewSchema.parse(
      buildInstantEvalProcessEventView(event),
    );
    const { ctx } = context();

    const evolution = handleInstantEvalPageJudged(running, payload, ctx);

    expect(evolution.state).toMatchObject({
      inputTokens: running.inputTokens + 200,
      costNanoUsd: 0,
      routedInputTokens: 0,
    });
  });
});
