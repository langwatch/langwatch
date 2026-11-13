// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/** The scheduled traffic pass. Spec: enterprise/modules/governance/specs/agent-registry.feature */
import type { ProcessHandlerContext } from "@langwatch/eventing";
import { intentAccessorOf } from "@langwatch/eventing/testing";
import { describe, expect, it } from "vitest";

import {
  AGENT_REGISTRY_TRAFFIC_INITIAL_STATE,
  AGENT_REGISTRY_TRAFFIC_INTERVAL_MS,
  AGENT_REGISTRY_TRAFFIC_PROCESS_NAME,
  type AgentRegistryTrafficIntents,
  agentRegistryTrafficWake,
  runAgentRegistryTraffic,
} from "../agent-registry-traffic.process.ts";

const NOW = 1_800_000_000_000;
const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;

const wakeAt = (at: number): ProcessHandlerContext<AgentRegistryTrafficIntents> => ({
  at,
  now: at,
  key: AGENT_REGISTRY_TRAFFIC_PROCESS_NAME,
  projectId: "__global__",
  intent: intentAccessorOf({
    pass: (key, payload) => ({ intentType: "pass", messageKey: key, payload }),
  }),
});

function pass({ failPrune = false }: { failPrune?: boolean } = {}) {
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
    now: () => NOW,
  });
  return { run, calls, pruned, walks };
}

describe("runAgentRegistryTraffic()", () => {
  describe("when a scheduled pass runs", () => {
    /** @scenario A traffic pass prunes its own bookkeeping older than a week */
    it("reconciles, then deletes its own dispatched rows older than seven days", async () => {
      const { run, calls, pruned, walks } = pass();

      await run({ everyOrganization: false });

      expect(calls).toEqual(["reconcile", "prune"]);
      expect(walks).toEqual([false]);
      expect(pruned).toEqual([
        { processName: AGENT_REGISTRY_TRAFFIC_PROCESS_NAME, before: NOW - WEEK_MS },
      ]);
    });

    it("succeeds when the prune fails", async () => {
      const { run } = pass({ failPrune: true });

      await expect(run({ everyOrganization: false })).resolves.toBeUndefined();
    });
  });
});

describe("agentRegistryTrafficWake()", () => {
  describe("when passes run through more than a day", () => {
    /** @scenario The daily traffic pass also reaches organisations the registry does not hold */
    it("walks every organisation on the first pass and again a day after the last full one", () => {
      const walksOf = (evolution: ReturnType<typeof agentRegistryTrafficWake>) =>
        evolution.intents
          ?.map((intent) => intent.payload as { everyOrganization: boolean })
          .map((payload) => payload.everyOrganization);

      const first = agentRegistryTrafficWake(AGENT_REGISTRY_TRAFFIC_INITIAL_STATE, wakeAt(NOW));
      const next = agentRegistryTrafficWake(
        first.state,
        wakeAt(NOW + AGENT_REGISTRY_TRAFFIC_INTERVAL_MS),
      );
      const dayLater = agentRegistryTrafficWake(next.state, wakeAt(NOW + DAY_MS));

      expect(walksOf(first)).toEqual([true]);
      expect(walksOf(next)).toEqual([false]);
      expect(walksOf(dayLater)).toEqual([true]);
    });
  });
});
