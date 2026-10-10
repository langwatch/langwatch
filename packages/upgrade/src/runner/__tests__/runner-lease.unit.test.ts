/**
 * @vitest-environment node
 * @see specs/upgrade/upgrade-logging.feature
 */
import { describe, expect, it } from "vitest";

import { holdUpgradeLease, DEFAULT_LEASE_TIMING } from "../runner-lease.ts";

const lease = {
  name: "upgrade",
  owner: "me",
  image: "x",
  host: "h",
  heartbeatAt: new Date(0),
  expiresAt: new Date(60_000),
};

function hold({ renewed }: { renewed: boolean }) {
  return holdUpgradeLease({
    ledger: {
      acquireLease: async () => lease,
      renewLease: async () => (renewed ? lease : null),
      releaseLease: async () => true,
    },
    runner: { findLease: async () => null },
    identity: { owner: "me", image: "x", host: "h" },
    timing: DEFAULT_LEASE_TIMING,
    log: { info: () => {}, warn: () => {} },
    signal: new AbortController().signal,
    work: async () => "ok",
  });
}

describe("holdUpgradeLease", () => {
  describe("when another runner took the lease before the first heartbeat", () => {
    it("reports the lease lost even though the work finished", async () => {
      expect(await hold({ renewed: false })).toMatchObject({ acquired: true, lost: true });
    });
  });

  describe("when this runner still holds the lease at the end", () => {
    it("reports it held", async () => {
      expect(await hold({ renewed: true })).toMatchObject({ acquired: true, lost: false });
    });
  });
});
