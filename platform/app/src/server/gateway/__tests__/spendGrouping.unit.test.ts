/**
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";

import { settlementGraceMs } from "~/server/event-sourcing/pipelines/gateway-spend-processing/process-manager/spendSettlement.process";

import {
  assertGroupingIsWalkable,
  isMovableGroupBy,
  windowHasSettled,
} from "../spendGrouping";

const NOW = 1_800_000_000_000;
/**
 * Read rather than assumed: the grace is overridable through
 * LW_SPEND_SETTLEMENT_GRACE_MS, so pinning the default here would make these
 * windows mean something else on a runner that sets it. Asserted positive so
 * a zero grace cannot make both windows the same window.
 */
const GRACE_MS = settlementGraceMs();
/** Inside the grace: outcomes for this window can still land. */
const LIVE_WINDOW_END = NOW - Math.floor(GRACE_MS / 2);
/** Past the grace: every admission has resolved or been settled. */
const SETTLED_WINDOW_END = NOW - GRACE_MS - 1;

/** The thrown error, so a test can assert on its code rather than its prose. */
function refusalFrom(run: () => void): { code?: string; meta?: unknown } {
  try {
    run();
  } catch (error) {
    return error as { code?: string; meta?: unknown };
  }
  throw new Error("expected the grouping to be refused, but it was served");
}

describe("given a spend rollup grouping", () => {
  it("runs against a grace that can actually separate the two windows", () => {
    expect(GRACE_MS).toBeGreaterThan(0);
  });

  describe("when the dimension is one the fold can rewrite", () => {
    it("names model and provider as movable", () => {
      // The fold replaces the REQUESTED model and provider with the ones that
      // actually served the request, so a row can change group after the fact.
      expect(isMovableGroupBy("model")).toBe(true);
      expect(isMovableGroupBy("provider")).toBe(true);
    });

    it("names the attribution dimensions as fixed", () => {
      for (const key of [
        "virtual_key",
        "end_user",
        "project",
        "principal",
        "request_type",
      ] as const) {
        expect(isMovableGroupBy(key)).toBe(false);
      }
    });
  });

  describe("when the window can still change", () => {
    /** @scenario "Grouping on a movable key is refused while the window is still settling" */
    it("refuses a movable grouping", () => {
      const refusal = refusalFrom(() =>
        assertGroupingIsWalkable({
          keys: ["model"],
          bucket: "none",
          toMs: LIVE_WINDOW_END,
          nowMs: NOW,
          allowUnstable: false,
        }),
      );
      expect(refusal.code).toBe("gateway_spend_group_by_unstable");
    });

    /** @scenario "Grouping on a key that cannot move is never refused" */
    it("serves a grouping whose key cannot move", () => {
      expect(() =>
        assertGroupingIsWalkable({
          keys: ["end_user", "virtual_key"],
          bucket: "none",
          toMs: LIVE_WINDOW_END,
          nowMs: NOW,
          allowUnstable: false,
        }),
      ).not.toThrow();
    });

    /** @scenario "A caller who accepts the risk can ask for it anyway" */
    it("serves a movable grouping when the caller accepts an inexact read", () => {
      expect(() =>
        assertGroupingIsWalkable({
          keys: ["model"],
          bucket: "none",
          toMs: LIVE_WINDOW_END,
          nowMs: NOW,
          allowUnstable: true,
        }),
      ).not.toThrow();
    });

    it("refuses a time bucket, because the occurred-at moves too", () => {
      // The admitted handler sets occurredAtMs unconditionally while every
      // outcome handler preserves the one already there, so an outcome that
      // races ahead of its admission has its instant rewritten and the
      // request changes bucket.
      const refusal = refusalFrom(() =>
        assertGroupingIsWalkable({
          keys: ["end_user"],
          bucket: "day",
          toMs: LIVE_WINDOW_END,
          nowMs: NOW,
          allowUnstable: false,
        }),
      );
      expect(refusal.code).toBe("gateway_spend_group_by_unstable");
    });
  });

  describe("when the window has settled", () => {
    /** @scenario "The same grouping is served once the window has settled" */
    it("serves the movable grouping it would have refused", () => {
      expect(windowHasSettled({ toMs: SETTLED_WINDOW_END, nowMs: NOW })).toBe(
        true,
      );
      expect(() =>
        assertGroupingIsWalkable({
          keys: ["model", "provider"],
          bucket: "day",
          toMs: SETTLED_WINDOW_END,
          nowMs: NOW,
          allowUnstable: false,
        }),
      ).not.toThrow();
    });
  });

  describe("when the refusal is rendered", () => {
    it("names which dimensions moved and when the window settles", () => {
      const refusal = refusalFrom(() =>
        assertGroupingIsWalkable({
          keys: ["model"],
          bucket: "hour",
          toMs: LIVE_WINDOW_END,
          nowMs: NOW,
          allowUnstable: false,
        }),
      );
      const meta = (refusal.meta ?? {}) as Record<string, unknown>;
      expect(meta.group_by).toEqual(["model", "bucket:hour"]);
      expect(meta.settles_at).toBe(
        new Date(LIVE_WINDOW_END + GRACE_MS).toISOString(),
      );
    });
  });
});
