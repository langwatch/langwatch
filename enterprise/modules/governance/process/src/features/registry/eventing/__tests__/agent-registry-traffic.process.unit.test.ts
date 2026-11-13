// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/** The scheduled traffic pass. Spec: enterprise/modules/governance/specs/agent-registry.feature */
import { describe, expect, it } from "vitest";

import {
  AGENT_REGISTRY_TRAFFIC_INTERVAL_MS,
  AGENT_REGISTRY_TRAFFIC_PROCESS_NAME,
  runAgentRegistryTraffic,
} from "../agent-registry-traffic.process.ts";

const NOW = 1_800_000_000_000;
const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

function pass({ failPrune = false, now = NOW }: { failPrune?: boolean; now?: number } = {}) {
  const calls: string[] = [];
  const walks: boolean[] = [];
  const pruned: { processName: string; before: number }[] = [];
  const run = runAgentRegistryTraffic({
    reconcile: async ({ everyOrganization }) => {
      calls.push("reconcile");
      walks.push(everyOrganization);
      return { organizations: 2 };
    },
    deleteDispatchedBefore: async (params) => {
      calls.push("prune");
      pruned.push(params);
      if (failPrune) throw new Error("process store unavailable");
      return 3;
    },
    now: () => now,
  });
  return { run, calls, pruned, walks };
}

describe("runAgentRegistryTraffic()", () => {
  describe("when a scheduled pass runs", () => {
    /** @scenario A traffic pass prunes its own bookkeeping older than a week */
    it("reconciles, then deletes its own dispatched rows older than seven days", async () => {
      const { run, calls, pruned } = pass();

      await run();

      expect(calls).toEqual(["reconcile", "prune"]);
      expect(pruned).toEqual([
        { processName: AGENT_REGISTRY_TRAFFIC_PROCESS_NAME, before: NOW - WEEK_MS },
      ]);
    });

    it("succeeds when the prune fails", async () => {
      const { run } = pass({ failPrune: true });

      await expect(run()).resolves.toBeUndefined();
    });
  });

  describe("when passes run through a day", () => {
    /** @scenario The daily traffic pass also reaches organisations the registry does not hold */
    it("walks every organisation on the day's first pass only", async () => {
      const DAY_MS = 24 * 60 * 60 * 1000;
      const midnight = Math.floor(NOW / DAY_MS) * DAY_MS;
      const first = pass({ now: midnight + 60_000 });
      const later = pass({ now: midnight + AGENT_REGISTRY_TRAFFIC_INTERVAL_MS + 60_000 });

      await first.run();
      await later.run();

      expect(first.walks).toEqual([true]);
      expect(later.walks).toEqual([false]);
    });
  });
});
