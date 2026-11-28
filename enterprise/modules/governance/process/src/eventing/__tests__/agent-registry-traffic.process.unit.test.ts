// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/** The scheduled traffic pass. Spec: enterprise/modules/governance/specs/agent-registry.feature */
import { InMemoryProcessStore, type ProcessHandlerContext } from "@langwatch/eventing";
import { intentAccessorOf } from "@langwatch/eventing/testing";
import { describe, expect, it } from "vitest";

import { agentRegistryWalkCheckpoint } from "../../features/registry/eventing/agent-registry-traffic.intent.ts";
import {
  AGENT_REGISTRY_TRAFFIC_INITIAL_STATE,
  AGENT_REGISTRY_TRAFFIC_INTERVAL_MS,
  AGENT_REGISTRY_TRAFFIC_PROCESS_NAME,
  type AgentRegistryTrafficIntents,
  type AgentRegistryTrafficState,
  type AgentRegistryWalkCheckpoint,
  agentRegistryTrafficWake,
  runAgentRegistryTraffic,
} from "../../features/registry/eventing/agent-registry-traffic.process.ts";

const NOW = 1_800_000_000_000;
const DAY_MS = 24 * 60 * 60 * 1000;
const WEEK_MS = 7 * DAY_MS;
const WORKER_KILLED = new Error("worker restarted mid-walk");

const wakeAt = (at: number): ProcessHandlerContext<AgentRegistryTrafficIntents> => ({
  at,
  now: at,
  key: AGENT_REGISTRY_TRAFFIC_PROCESS_NAME,
  projectId: "__global__",
  intent: intentAccessorOf({
    pass: (key, payload) => ({ intentType: "pass", messageKey: key, payload }),
  }),
});

type PassPayload = { everyOrganization: boolean };
const payloadOf = (evolution: ReturnType<typeof agentRegistryTrafficWake>) =>
  evolution.intents?.[0]?.payload as PassPayload;

const NO_WALK: AgentRegistryWalkCheckpoint = {
  getProgress: async () => ({ walk: "closed" }),
  save: async () => {},
  complete: async () => {},
};

function pass({ failPrune = false }: { failPrune?: boolean } = {}) {
  const calls: string[] = [];
  const walks: boolean[] = [];
  const pruned: { processName: string; before: number }[] = [];
  const run = runAgentRegistryTraffic({
    reconcile: async ({ everyOrganization }) => {
      calls.push("reconcile");
      walks.push(everyOrganization);
      return { organizations: 2, complete: true };
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

/** The traffic process's state row in a store, as the runtime would hold it. */
async function processRow(state: AgentRegistryTrafficState) {
  const store = InMemoryProcessStore.createForTesting();
  const ref = {
    processName: AGENT_REGISTRY_TRAFFIC_PROCESS_NAME,
    projectId: "__global__",
    processKey: AGENT_REGISTRY_TRAFFIC_PROCESS_NAME,
  };
  await store.commit({
    ref,
    tenantId: "__global__",
    sourceEventId: null,
    expectedRevision: 0,
    state,
    nextWakeAt: NOW + AGENT_REGISTRY_TRAFFIC_INTERVAL_MS,
    messages: [],
    now: NOW,
  });
  const checkpoint = agentRegistryWalkCheckpoint({
    processStore: store,
    context: { ...ref, tenantId: "__global__" },
    now: () => NOW + DAY_MS,
  });
  const read = async () =>
    ((await store.findByRef({ ref })) as { state: AgentRegistryTrafficState }).state;
  return { checkpoint, read };
}

describe("runAgentRegistryTraffic()", () => {
  describe("when a scheduled pass runs", () => {
    /** @scenario A traffic pass prunes its own bookkeeping older than a week */
    it("reconciles, then deletes its own dispatched rows older than seven days", async () => {
      const { run, calls, pruned, walks } = pass();

      await run({ everyOrganization: false }, NO_WALK);

      expect(calls).toEqual(["reconcile", "prune"]);
      expect(walks).toEqual([false]);
      expect(pruned).toEqual([
        { processName: AGENT_REGISTRY_TRAFFIC_PROCESS_NAME, before: NOW - WEEK_MS },
      ]);
    });

    it("succeeds when the prune fails", async () => {
      const { run } = pass({ failPrune: true });

      await expect(run({ everyOrganization: false }, NO_WALK)).resolves.toBeUndefined();
    });
  });

  describe("when a walk is cut short and a later pass runs", () => {
    /** @scenario An interrupted walk resumes from its cursor on the next pass */
    it("keeps the cursor, resumes after it and marks the walk complete only at the end", async () => {
      const first = agentRegistryTrafficWake(AGENT_REGISTRY_TRAFFIC_INITIAL_STATE, wakeAt(NOW));
      const { checkpoint, read } = await processRow(first.state);
      const startedFrom: (string | undefined)[] = [];
      const run = (walk: (onPage: (cursor: string) => Promise<void>) => Promise<boolean>) =>
        runAgentRegistryTraffic({
          reconcile: async ({ after, onPage }) => {
            startedFrom.push(after);
            const complete = await walk((cursor) =>
              onPage
                ? onPage({ afterOrganizationId: cursor, organizations: 1 })
                : Promise.resolve(),
            );
            return { organizations: 1, complete };
          },
          deleteDispatchedBefore: async () => 0,
          now: () => NOW,
        });

      await expect(
        run(async (onPage) => {
          await onPage("org-100");
          throw WORKER_KILLED;
        })(payloadOf(first), checkpoint),
      ).rejects.toBe(WORKER_KILLED);
      expect(await read()).toMatchObject({ lastFullPassAt: null, walkAfter: "org-100" });

      const next = agentRegistryTrafficWake(
        await read(),
        wakeAt(NOW + AGENT_REGISTRY_TRAFFIC_INTERVAL_MS),
      );
      expect(payloadOf(next)).toMatchObject({ everyOrganization: true });
      await run(async (onPage) => {
        await onPage("org-200");
        return true;
      })(payloadOf(next), checkpoint);

      expect(startedFrom).toEqual([undefined, "org-100"]);
      expect(await read()).toMatchObject({
        lastFullPassAt: NOW + DAY_MS,
        walkStartedAt: null,
        walkAfter: null,
      });
    });
  });
});

describe("a walk pass after its walk was finished", () => {
  describe("when the pass finds the walk closed", () => {
    /** @scenario A walk pass whose walk another pass finished reconciles nothing */
    it("does not reconcile", async () => {
      const { run, calls } = pass();

      await run({ everyOrganization: true }, NO_WALK);

      expect(calls).toEqual(["prune"]);
    });
  });

  describe("when a late pass of a finished walk saves its cursor", () => {
    /** @scenario A walk pass whose walk another pass finished reconciles nothing */
    it("leaves the state as the completed walk wrote it", async () => {
      const first = agentRegistryTrafficWake(AGENT_REGISTRY_TRAFFIC_INITIAL_STATE, wakeAt(NOW));
      const { checkpoint, read } = await processRow(first.state);

      await checkpoint.complete({ startedAt: NOW });
      await checkpoint.save({ startedAt: NOW, after: "org-stale", done: 1 });

      expect(await read()).toMatchObject({
        lastFullPassAt: NOW + DAY_MS,
        walkStartedAt: null,
        walkAfter: null,
      });
    });
  });
});

describe("two passes saving the same open walk", () => {
  describe("when the pass that is behind saves last", () => {
    /** @scenario A walk's saved cursor never moves back */
    it("keeps the cursor of the pass that got further", async () => {
      const first = agentRegistryTrafficWake(AGENT_REGISTRY_TRAFFIC_INITIAL_STATE, wakeAt(NOW));
      const { checkpoint, read } = await processRow(first.state);

      await checkpoint.save({ startedAt: NOW, after: "org-300", done: 300 });
      await checkpoint.save({ startedAt: NOW, after: "org-100", done: 100 });

      expect(await read()).toMatchObject({ walkAfter: "org-300", walkDone: 300 });
    });
  });
});

describe("agentRegistryTrafficWake()", () => {
  describe("when passes run through more than a day", () => {
    /** @scenario The daily traffic pass also reaches organisations the registry does not hold */
    it("walks every organisation on the first pass and again a day after the last completed one", () => {
      const first = agentRegistryTrafficWake(AGENT_REGISTRY_TRAFFIC_INITIAL_STATE, wakeAt(NOW));
      const completed = { ...first.state, lastFullPassAt: NOW, walkStartedAt: null };
      const next = agentRegistryTrafficWake(
        completed,
        wakeAt(NOW + AGENT_REGISTRY_TRAFFIC_INTERVAL_MS),
      );
      const dayLater = agentRegistryTrafficWake(next.state, wakeAt(NOW + DAY_MS));

      expect(payloadOf(first)).toMatchObject({ everyOrganization: true });
      expect(payloadOf(next)).toMatchObject({ everyOrganization: false });
      expect(payloadOf(dayLater)).toMatchObject({ everyOrganization: true });
    });
  });
});
