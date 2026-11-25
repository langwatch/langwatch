/**
 * A verified mark is decided on the attributes the store keeps (ADR-201 §4, v1.17): the projection
 * preview and canonicalisation run after admission, so a mark outlives neither. Drives the REAL
 * lean, normalisation and canonicalisation. Spec: modules/trace/specs/signed-calls.feature
 */
import { VERIFIED_ATTRIBUTE_PREFIX } from "@langwatch/authorization";
import type { NormalizedSpan, SpanReceivedEvent } from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";

import { leanForProjection } from "../../features/projection/rules/trace-projection-lean.rules.ts";
import { SpanStorageMapProjection } from "../span-storage.projection.ts";
import { createSpanReceivedEvent, createTestRuntime } from "./trace-summary-test.fixtures.ts";

const SIGNER = "proj_orchestrator";
const markOf = (key: string) => `${VERIFIED_ATTRIBUTE_PREFIX}${key}`;
/** Past the projection's preview budget for a plain attribute (256 KiB). */
const OVERSIZED = "w".repeat(300_000);
/** A legacy key canonicalisation moves to `gen_ai.usage.cache_read.input_tokens`. */
const CACHED_INPUT = "gen_ai.usage.cached_input_tokens";

const runtime = createTestRuntime();
const noopAppendStore = { append: async () => {}, bulkAppend: async () => {} } as never;

/** The span row the store would write for an admitted event, after the projection's own steps. */
function storedFor(event: SpanReceivedEvent): NormalizedSpan["spanAttributes"] {
  const projection = SpanStorageMapProjection.create({
    store: noopAppendStore,
    spanCostService: runtime.spanCost,
    spanNormalization: runtime.spanNormalization,
  });
  const stored = projection.mapTraceSpanReceived(leanForProjection(event));
  if (!stored) throw new Error("the span was not storable");
  return stored.spanAttributes;
}

/** An admitted span: each entry marked verified by the signer, as admission leaves it. */
function admittedWith(entries: Record<string, string>): SpanReceivedEvent {
  const marks = Object.fromEntries(Object.keys(entries).map((key) => [markOf(key), SIGNER]));
  return createSpanReceivedEvent({ attributes: { ...entries, ...marks } });
}

describe("storing a span admitted with verified marks", () => {
  describe("when the projection previews a signed entry too large to keep whole", () => {
    /** @scenario "A signed entry the store previews or canonicalises keeps no verified mark" */
    it("stores the preview without the entry's mark, and keeps an untouched entry's", () => {
      const stored = storedFor(admittedWith({ "app.ticket": OVERSIZED, orchestrator: "web" }));

      expect(stored["app.ticket"]).not.toBe(OVERSIZED);
      expect(stored[markOf("app.ticket")]).toBeUndefined();
      expect(stored.orchestrator).toBe("web");
      expect(stored[markOf("orchestrator")]).toBe(SIGNER);
    });
  });

  describe("when canonicalisation moves a signed entry to another key", () => {
    /** @scenario "A signed entry the store previews or canonicalises keeps no verified mark" */
    it("stores no mark for the key the entry left", () => {
      const stored = storedFor(
        admittedWith({
          "gen_ai.request.model": "gpt-5-mini",
          [CACHED_INPUT]: "12",
          orchestrator: "web",
        }),
      );

      expect(stored[CACHED_INPUT]).toBeUndefined();
      expect(stored[markOf(CACHED_INPUT)]).toBeUndefined();
      expect(stored[markOf("orchestrator")]).toBe(SIGNER);
    });
  });

  describe("when a mark names an entry the span does not carry", () => {
    /** @scenario "A signed entry the store previews or canonicalises keeps no verified mark" */
    it("stores no mark, so an absent key never reads as a verified empty value", () => {
      const event = createSpanReceivedEvent({ attributes: { [markOf("tier")]: SIGNER } });

      expect(storedFor(event)[markOf("tier")]).toBeUndefined();
    });
  });
});
