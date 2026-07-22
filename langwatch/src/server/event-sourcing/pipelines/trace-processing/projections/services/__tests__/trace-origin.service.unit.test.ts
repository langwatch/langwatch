/**
 * @vitest-environment node
 *
 * Pins the origin fold's platform-origin precedence. A Langy turn's trace
 * carries BOTH explicit platform origins — the manager's relay stamps
 * "langy" on the turn span + relayed worker spans, while the AI gateway
 * stamps "gateway" on the gen_ai spans it retells into the same trace.
 * Under the old "explicit always wins" rule, whichever span folded last
 * decided the trace summary, so the same turn flipped between "langy" and
 * "gateway" depending on arrival order. Langy outranks the gateway, in
 * both fold orders.
 */
import { describe, expect, it } from "vitest";

import type { TraceSummaryData } from "~/server/app-layer/traces/types";
import type { NormalizedSpan } from "../../schemas/spans";
import { TraceOriginService } from "../trace-origin.service";

function makeSpan(
  overrides: Partial<
    Pick<
      NormalizedSpan,
      "spanAttributes" | "resourceAttributes" | "parentSpanId"
    >
  > = {},
): NormalizedSpan {
  return {
    parentSpanId: "parent-1",
    spanAttributes: {},
    resourceAttributes: {},
    ...overrides,
  } as NormalizedSpan;
}

function makeState(origin?: string): TraceSummaryData {
  return {
    attributes: origin ? { "langwatch.origin": origin } : {},
  } as TraceSummaryData;
}

function hoist(state: TraceSummaryData, span: NormalizedSpan) {
  const mergedAttributes: Record<string, string> = {};
  new TraceOriginService().hoistOrigin({ state, span, mergedAttributes });
  return mergedAttributes;
}

describe("TraceOriginService.hoistOrigin", () => {
  describe("when a gateway gen_ai span folds after the trace resolved to langy", () => {
    it("keeps langy — the gateway never displaces it", () => {
      const merged = hoist(
        makeState("langy"),
        makeSpan({ resourceAttributes: { "langwatch.origin": "gateway" } }),
      );
      expect(merged["langwatch.origin"]).toBe("langy");
    });

    it("keeps langy for a span-level gateway origin too", () => {
      const merged = hoist(
        makeState("langy"),
        makeSpan({ spanAttributes: { "langwatch.origin": "gateway" } }),
      );
      expect(merged["langwatch.origin"]).toBe("langy");
    });
  });

  describe("when a langy span folds after the trace resolved to gateway", () => {
    it("upgrades the trace to langy", () => {
      const merged = hoist(
        makeState("gateway"),
        makeSpan({ spanAttributes: { "langwatch.origin": "langy" } }),
      );
      expect(merged["langwatch.origin"]).toBe("langy");
    });
  });

  describe("when the trace has no resolved origin yet", () => {
    it("takes the gateway origin as usual", () => {
      const merged = hoist(
        makeState(),
        makeSpan({ resourceAttributes: { "langwatch.origin": "gateway" } }),
      );
      expect(merged["langwatch.origin"]).toBe("gateway");
    });
  });

  describe("when a non-platform explicit origin folds over langy", () => {
    it("still wins — the precedence rule is scoped to the gateway", () => {
      const merged = hoist(
        makeState("langy"),
        makeSpan({ spanAttributes: { "langwatch.origin": "coding_agent" } }),
      );
      expect(merged["langwatch.origin"]).toBe("coding_agent");
    });
  });
});
