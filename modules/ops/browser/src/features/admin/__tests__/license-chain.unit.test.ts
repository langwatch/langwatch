import { describe, expect, it } from "vitest";

import { EXTEND_PRESETS, extendProblem, presetEnd } from "../model/extend-term.ts";
import { licenseChainState, nextSyncText } from "../model/license-chain.ts";
import type { License } from "../model/license-terms.ts";

const row = (overrides: Partial<License>) =>
  ({
    id: "il_1",
    status: "active",
    hasPendingDelivery: false,
    instanceId: "acme-prod",
    expiresAt: "2026-12-01T12:00:00.000Z",
    ...overrides,
  }) as License;

describe("licenseChainState", () => {
  describe("when the newest license waits for delivery", () => {
    it("reads it as pending and the one before it as in use", () => {
      const state = licenseChainState({
        licenses: [row({ id: "il_2", hasPendingDelivery: true }), row({ id: "il_1" })],
      });

      expect(state?.head.id).toBe("il_2");
      expect(state?.pending?.id).toBe("il_2");
      expect(state?.inUse.id).toBe("il_1");
      expect(state?.unbound).toBe(false);
    });
  });

  describe("when the replacement was delivered", () => {
    it("reads the newest license as in use and the replaced one as no longer live", () => {
      const state = licenseChainState({
        licenses: [row({ id: "il_2" }), row({ id: "il_1", status: "superseded" })],
      });

      expect(state?.pending).toBeNull();
      expect(state?.inUse.id).toBe("il_2");
      expect(state?.live.map((license) => license.id)).toEqual(["il_2"]);
    });
  });

  it("reads a chain no install presented as unbound", () => {
    expect(licenseChainState({ licenses: [row({ instanceId: null })] })?.unbound).toBe(true);
  });

  /** @scenario "An unused key left working still shows after the drawer is opened again" */
  it("names the replaced keys of an unbound chain that are still live, never the newest", () => {
    const newest = row({ id: "il_2", instanceId: null });
    const replaced = row({ id: "il_1", instanceId: null });
    const state = licenseChainState({ licenses: [newest, replaced] });

    expect(state?.leftover.map((license) => license.id)).toEqual(["il_1"]);
    expect(licenseChainState({ licenses: [row({ id: "il_2" }), row({})] })?.leftover).toEqual([]);
  });

  /** @scenario "After a binding reset the drawer treats the chain as unused" */
  it("reads a reset chain as unbound though a superseded license names the old install", () => {
    const state = licenseChainState({
      licenses: [
        row({ id: "il_2", instanceId: null }),
        row({ id: "il_1", status: "superseded", instanceId: "acme-prod" }),
      ],
    });

    expect(state?.unbound).toBe(true);
  });
});

describe("nextSyncText", () => {
  const lastSyncAt = "2026-11-25T06:00:00.000Z";
  const at = (iso: string) => new Date(iso).getTime();

  it("counts the hours to the next daily sync", () => {
    expect(nextSyncText({ lastSyncAt, nowMs: at("2026-11-25T10:00:00.000Z") })).toBe(
      "next sync in about 20 hours",
    );
  });

  it("says it is due once a day has passed", () => {
    expect(nextSyncText({ lastSyncAt, nowMs: at("2026-11-26T07:00:00.000Z") })).toBe(
      "next sync due now",
    );
  });
});

describe("extending the term", () => {
  const expiresAt = "2026-12-01T12:00:00.000Z";

  it("moves the end by each preset from where it ends now", () => {
    expect(EXTEND_PRESETS.map((preset) => presetEnd({ expiresAt, preset }))).toEqual([
      "2026-12-15",
      "2027-01-01",
      "2027-03-01",
      "2027-12-01",
    ]);
  });

  it("accepts a later day and refuses the same day or an earlier one", () => {
    expect(extendProblem({ expiresAt, newEnd: "2026-12-02" })).toBeUndefined();
    expect(extendProblem({ expiresAt, newEnd: "2026-12-01" })).toBe(
      "The new end date must be after Dec 1, 2026.",
    );
    expect(extendProblem({ expiresAt, newEnd: "" })).toBe("Pick the new end date.");
  });
});
