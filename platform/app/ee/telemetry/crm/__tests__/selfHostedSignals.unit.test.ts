/**
 * The six things a self-hosted install can do that somebody should hear
 * about, and the rule that keeps them from becoming a daily digest.
 *
 * @see ../selfHostedSignals.ts
 * @see specs/self-hosting/connected-services/self-hosted-lead-signals.feature
 */

import { describe, expect, it } from "vitest";

import { type SignalInput, signalsRaisedBy } from "../selfHostedSignals";

const NOW = new Date("2026-09-21T12:00:00.000Z");
const DAY_MS = 24 * 60 * 60 * 1000;

function inputOf(overrides: Partial<SignalInput> = {}): SignalInput {
  return {
    properties: { users: 3, traces_28d: 10 },
    firstSeenAt: new Date(NOW.getTime() - 90 * DAY_MS),
    alreadyRaised: [],
    license: null,
    domainHasCloudAccount: false,
    now: NOW,
    ...overrides,
  };
}

describe("given an install reporting more users than a team has", () => {
  describe("when its report arrives", () => {
    /** @scenario "An install that grew past a team is raised" */
    it("raises the seats signal", () => {
      const raised = signalsRaisedBy(
        inputOf({ properties: { users: 40, traces_28d: 0 } }),
      );
      expect(raised).toContain("seats_crossed_threshold");
    });
  });
});

describe("given an install ingesting heavily that was first seen yesterday", () => {
  describe("when its report arrives", () => {
    /** @scenario "Ingestion is only raised once the install has been running a month" */
    it("waits until a twenty-eight day window means what it says", () => {
      const heavy = { users: 4, traces_28d: 500_000 };

      const young = signalsRaisedBy(
        inputOf({
          properties: heavy,
          firstSeenAt: new Date(NOW.getTime() - DAY_MS),
        }),
      );
      expect(young).not.toContain("sustained_ingestion");

      const established = signalsRaisedBy(
        inputOf({
          properties: heavy,
          firstSeenAt: new Date(NOW.getTime() - 30 * DAY_MS),
        }),
      );
      expect(established).toContain("sustained_ingestion");
    });
  });
});

describe("given an install with single sign-on and no license bound", () => {
  describe("when its report arrives", () => {
    /** @scenario "A licensed feature running without a license is raised" */
    it("raises the licensed feature signal", () => {
      const raised = signalsRaisedBy(
        inputOf({
          properties: { users: 5, sso_provider: "okta" },
          license: null,
        }),
      );
      expect(raised).toContain("licensed_feature_without_license");
    });

    it("says nothing when the same install holds a license", () => {
      const raised = signalsRaisedBy(
        inputOf({
          properties: { users: 5, sso_provider: "okta" },
          license: { expiresAt: new Date(NOW.getTime() + 300 * DAY_MS) },
        }),
      );
      expect(raised).not.toContain("licensed_feature_without_license");
    });
  });
});

describe("given a license that ends soon", () => {
  describe("when the report arrives", () => {
    /** @scenario "A license about to lapse is raised" */
    it("raises it three weeks out and not a year out", () => {
      const soon = signalsRaisedBy(
        inputOf({
          license: { expiresAt: new Date(NOW.getTime() + 21 * DAY_MS) },
        }),
      );
      expect(soon).toContain("license_expiring");

      const later = signalsRaisedBy(
        inputOf({
          license: { expiresAt: new Date(NOW.getTime() + 365 * DAY_MS) },
        }),
      );
      expect(later).not.toContain("license_expiring");
    });

    it("says nothing about a term that already ended, which is a different conversation", () => {
      const lapsed = signalsRaisedBy(
        inputOf({ license: { expiresAt: new Date(NOW.getTime() - DAY_MS) } }),
      );
      expect(lapsed).not.toContain("license_expiring");
    });
  });
});

describe("given users on a domain that already has a LangWatch Cloud account", () => {
  describe("when the report arrives", () => {
    /** @scenario "A company that already has an account with us is raised" */
    it("raises the domain signal", () => {
      const raised = signalsRaisedBy(inputOf({ domainHasCloudAccount: true }));
      expect(raised).toContain("domain_has_cloud_account");
    });
  });
});

describe("given a connected install whose license stopped syncing", () => {
  describe("when the report arrives", () => {
    /** @scenario "A licensed install that stopped syncing is raised" */
    it("raises the stale sync signal after a week of silence and not after a day", () => {
      const expiresAt = new Date(NOW.getTime() + 300 * DAY_MS);

      const stale = signalsRaisedBy(
        inputOf({
          license: {
            expiresAt,
            lastSyncAt: new Date(NOW.getTime() - 8 * DAY_MS),
          },
        }),
      );
      expect(stale).toContain("license_sync_stale");

      const fresh = signalsRaisedBy(
        inputOf({
          license: { expiresAt, lastSyncAt: new Date(NOW.getTime() - DAY_MS) },
        }),
      );
      expect(fresh).not.toContain("license_sync_stale");
    });

    it("says nothing about a license that never synced, which was never connected", () => {
      const raised = signalsRaisedBy(
        inputOf({
          license: {
            expiresAt: new Date(NOW.getTime() + 300 * DAY_MS),
            lastSyncAt: null,
          },
        }),
      );
      expect(raised).not.toContain("license_sync_stale");
    });
  });
});

describe("given an install that already raised the seats signal", () => {
  describe("when it reports the same size tomorrow", () => {
    /** @scenario "A signal already raised is never raised again" */
    it("raises nothing at all", () => {
      const raised = signalsRaisedBy(
        inputOf({
          properties: { users: 40, traces_28d: 0 },
          alreadyRaised: ["seats_crossed_threshold"],
        }),
      );
      expect(raised).toEqual([]);
    });
  });
});
