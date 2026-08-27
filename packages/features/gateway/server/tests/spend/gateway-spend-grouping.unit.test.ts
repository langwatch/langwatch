/**
 * @vitest-environment node
 */
import { describe, expect, it } from "vitest";

import {
  assertGroupingIsWalkable,
  FixedGatewaySettlementPolicy,
  isIanaTimeZone,
  isMovableGroupBy,
  windowHasSettled,
} from "@langwatch/gateway-server";

const NOW = 1_800_000_000_000;
/**
 * Read rather than assumed: the grace is overridable through
 * LW_SPEND_SETTLEMENT_GRACE_MS, so pinning the default here would make these
 * windows mean something else on a runner that sets it. Asserted positive so
 * a zero grace cannot make both windows the same window.
 */
const settlementPolicy = FixedGatewaySettlementPolicy.create(30 * 60 * 1000);
const GRACE_MS = settlementPolicy.graceMs();
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
    it("refuses a movable grouping", () => {
      const refusal = refusalFrom(() =>
        assertGroupingIsWalkable({
          keys: ["model"],
          bucket: "none",
          toMs: LIVE_WINDOW_END,
          nowMs: NOW,
          allowUnstable: false,
          settlementPolicy,
        }),
      );
      expect(refusal.code).toBe("gateway_spend_group_by_unstable");
    });

    it("serves a grouping whose key cannot move", () => {
      expect(() =>
        assertGroupingIsWalkable({
          keys: ["end_user", "virtual_key"],
          bucket: "none",
          toMs: LIVE_WINDOW_END,
          nowMs: NOW,
          allowUnstable: false,
          settlementPolicy,
        }),
      ).not.toThrow();
    });

    it("serves a movable grouping when the caller accepts an inexact read", () => {
      expect(() =>
        assertGroupingIsWalkable({
          keys: ["model"],
          bucket: "none",
          toMs: LIVE_WINDOW_END,
          nowMs: NOW,
          allowUnstable: true,
          settlementPolicy,
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
          settlementPolicy,
        }),
      );
      expect(refusal.code).toBe("gateway_spend_group_by_unstable");
    });
  });

  describe("when the window has settled", () => {
    it("serves the movable grouping it would have refused", () => {
      expect(
        windowHasSettled({ toMs: SETTLED_WINDOW_END, nowMs: NOW, settlementPolicy }),
      ).toBe(true);
      expect(() =>
        assertGroupingIsWalkable({
          keys: ["model", "provider"],
          bucket: "day",
          toMs: SETTLED_WINDOW_END,
          nowMs: NOW,
          allowUnstable: false,
          settlementPolicy,
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
          settlementPolicy,
        }),
      );
      const meta = (refusal.meta ?? {}) as Record<string, unknown>;
      expect(meta.group_by).toEqual(["model", "bucket:hour"]);
      expect(meta.settles_at).toBe(new Date(LIVE_WINDOW_END + GRACE_MS).toISOString());
    });
  });

  describe("when a time zone is named", () => {
    it("accepts the named zones the store can load", () => {
      for (const zone of ["UTC", "Europe/Amsterdam", "Etc/GMT+5", "Zulu"]) {
        expect(isIanaTimeZone(zone), zone).toBe(true);
      }
    });

    /** @scenario "A time zone the store cannot load is refused at the door" */
    it("refuses a fixed offset the runtime would otherwise accept", () => {
      // Every spelling below builds an Intl formatter without complaint, and
      // every one makes ClickHouse answer "Cannot load time zone". Accepting
      // them here turns a value the caller chose into an unknown error thrown
      // from a place they cannot see.
      for (const offset of ["+05:00", "+0500", "-08:00", "+05"]) {
        expect(
          () => new Intl.DateTimeFormat("en-US", { timeZone: offset }),
          offset,
        ).not.toThrow();
        expect(isIanaTimeZone(offset), offset).toBe(false);
      }
    });

    it("still refuses a name no zone database has", () => {
      expect(isIanaTimeZone("Nowhere/Special")).toBe(false);
      expect(isIanaTimeZone("")).toBe(false);
    });
  });
});
