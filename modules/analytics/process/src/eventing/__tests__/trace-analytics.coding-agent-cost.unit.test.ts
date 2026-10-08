/**
 * One Claude Code model call priced by analytics' two trace surfaces, against the same two
 * amounts trace's coding-agent-cost-agreement test pins every trace surface to.
 * See specs/coding-agent/cache-write-ttl-pricing.feature.
 */
import type { SpanReceivedEvent } from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";

import { TraceAnalyticsRollupMapProjection } from "../trace-analytics-rollup.projection.ts";
import { TraceAnalyticsFoldProjection } from "../trace-analytics.projection.ts";
import { createSpanReceivedEvent } from "./trace-analytics-test.fixtures.ts";

const START_MS = 1_700_000_000_500;
const END_MS = 1_700_000_002_500;

/** A cache-heavy turn: two fresh input tokens, a short reply, large cache reads and writes. */
const CALL = {
  model: "claude-opus-5",
  input_tokens: 2,
  output_tokens: 210,
  cache_read_tokens: 18_443,
  cache_creation_tokens: 17_854,
};

/** What the provider charged for that turn, with hour-long cache writes. */
const CHARGED_USD = 0.1930215;
/** The same call with five-minute writes: what a call stating no context is priced at. */
const SHORT_LIVED_USD = 0.126069;
/** Folds round their running total, so the surfaces agree to a millionth of a dollar. */
const CENTS_OF_A_CENT = 6;

type CallExtra = Record<string, string | number>;

const noopFoldStore = { store: async () => {}, get: async () => ({ kind: "empty" as const }) };
const noopAppendStore = { append: async () => {}, bulkAppend: async () => {} } as never;

function claudeCallEvent(extra: CallExtra): SpanReceivedEvent {
  return createSpanReceivedEvent({
    traceId: "a1b2c3d4e5f6a7b8c9d0e1f2a3b4c5d6",
    spanId: "bbbb000000000001",
    name: "claude_code.llm_request",
    startTimeUnixNano: String(START_MS * 1_000_000),
    endTimeUnixNano: String(END_MS * 1_000_000),
    attributes: { ...CALL, ...extra, "langwatch.span.type": "llm" },
  });
}

function surfaces(extra: CallExtra): Record<string, number | null> {
  const fold = TraceAnalyticsFoldProjection.create({ store: noopFoldStore });
  const rollup = TraceAnalyticsRollupMapProjection.create({ store: noopAppendStore });
  return {
    traceAnalytics: fold.handleTraceSpanReceived(claudeCallEvent(extra), fold.init()).totalCost,
    analyticsRollup: rollup.mapTraceSpanReceived(claudeCallEvent(extra))?.costSum ?? null,
  };
}

function mismatches(extra: CallExtra, expected: number): string[] {
  const tolerance = 0.5 * 10 ** -CENTS_OF_A_CENT;
  return Object.entries(surfaces(extra))
    .filter(([, cost]) => cost === null || Math.abs(cost - expected) > tolerance)
    .map(([surface, cost]) => `${surface}=${String(cost)}`);
}

describe("analytics' price of one claude code model call", () => {
  describe("given a main-thread call, whose cache writes are hour-long", () => {
    /** @scenario "Analytics' trace analytics fold and rollup price a call the same as every other pricing surface" */
    it("reaches the amount the provider charged, in the fold and the rollup", () => {
      expect(mismatches({ "llm_request.context": "interaction" }, CHARGED_USD)).toEqual([]);
    });
  });

  describe("given a call whose cache writes carry no stated lifetime", () => {
    /** @scenario "Analytics' trace analytics fold and rollup price a call the same as every other pricing surface" */
    it("prices the writes short-lived, in the fold and the rollup", () => {
      expect(mismatches({}, SHORT_LIVED_USD)).toEqual([]);
    });
  });
});
