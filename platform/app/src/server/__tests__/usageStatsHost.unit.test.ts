/**
 * Where the daily product statistics go, and what switching them off stops.
 *
 * Statistics and the license sync are two posts with two switches. An install
 * that turns statistics off still syncs its license, because the sync is what
 * keeps its seats working, and a connected install sends both to the one host
 * it already talks to.
 *
 * @see ../usageStatsWorker.ts
 * @see ../licenseSyncWorker.ts
 * @see specs/self-hosting/connected-services/license-sync.feature
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("~/server/db", () => ({ prisma: {} }));

vi.mock("~/server/app-layer/app", () => ({
  tryGetApp: () => null,
  getApp: () => ({}),
}));

const { connectEnabled, statsDisabled, entitled } = vi.hoisted(() => ({
  connectEnabled: { current: true },
  statsDisabled: { current: false },
  entitled: { current: true },
}));

vi.mock("@ee/licensing/connect/install/connectConfig", () => ({
  readConnectConfig: () => ({
    permitted: connectEnabled.current,
    gatewayEndpoint: "https://gateway.langwatch.ai",
    licenseEndpoint: "https://connect.langwatch.ai",
  }),
}));

// Whether any license on this install names a hosted service. Read out of the
// signed blob in the real thing, which has its own suite; what this one pins
// is which host the two daily jobs choose once that answer is known.
vi.mock("@ee/licensing/connect/install/connectEntitlement", () => ({
  installIsEntitled: async () => connectEnabled.current && entitled.current,
  licenseConnectServices: () =>
    connectEnabled.current && entitled.current ? ["instant_evals"] : [],
}));

vi.mock("~/env.mjs", () => ({
  env: {
    get DISABLE_USAGE_STATS() {
      return statsDisabled.current;
    },
    IS_SAAS: false,
  },
}));

import { startLicenseSyncWorker } from "../licenseSyncWorker";
import {
  startUsageStatsWorker,
  USAGE_STATS_APP_HOST_URL,
  usageStatsEndpoint,
} from "../usageStatsWorker";

beforeEach(() => {
  connectEnabled.current = true;
  statsDisabled.current = false;
  entitled.current = true;
});

describe("given an install whose license names a hosted service", () => {
  describe("when the daily jobs run", () => {
    /** @scenario "Product statistics go to the connect host, not the app host" */
    it("posts the statistics to the connect host", async () => {
      await expect(usageStatsEndpoint()).resolves.toBe(
        "https://connect.langwatch.ai/v1/stats",
      );
    });
  });

  describe("when usage statistics are switched off for the deployment", () => {
    /** @scenario "Product statistics stay optional and separate" */
    it("sends no statistics, and still syncs the license", () => {
      statsDisabled.current = true;

      expect(startUsageStatsWorker()).toBeUndefined();

      const sync = startLicenseSyncWorker();
      expect(sync).toBeDefined();
      sync?.stop();
    });
  });
});

describe("given an install with Connect switched off for an audit", () => {
  describe("when the daily jobs run", () => {
    /** @scenario "An install with Connect disabled sends no sync" */
    it("posts the statistics where it always did, and syncs nothing", async () => {
      connectEnabled.current = false;

      await expect(usageStatsEndpoint()).resolves.toBe(
        USAGE_STATS_APP_HOST_URL,
      );
      expect(startLicenseSyncWorker()).toBeUndefined();
    });
  });
});

describe("given an install on an offline license", () => {
  describe("when the daily jobs run", () => {
    /** @scenario "An install on an offline license keeps its telemetry destination" */
    it("posts the statistics where it always did", async () => {
      entitled.current = false;

      await expect(usageStatsEndpoint()).resolves.toBe(
        USAGE_STATS_APP_HOST_URL,
      );
    });
  });
});
