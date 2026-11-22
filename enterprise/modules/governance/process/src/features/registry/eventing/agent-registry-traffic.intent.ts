// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { IntentContext, ProcessStore } from "@langwatch/eventing";
import { nowInstant } from "@langwatch/time";

import {
  type AgentRegistryTrafficState,
  agentRegistryTrafficStateSchema,
  type AgentRegistryWalkCheckpoint,
} from "./agent-registry-traffic.process.ts";

/**
 * The walk's progress, read and written in the traffic process's own state row. A write from a
 * pass whose walk already finished or was replaced leaves the state as it is.
 */
export function agentRegistryWalkCheckpoint({
  processStore,
  context,
  now = () => nowInstant().epochMilliseconds,
}: {
  processStore: Pick<ProcessStore, "findByRef" | "transact">;
  context: Pick<IntentContext, "processName" | "projectId" | "processKey" | "tenantId">;
  now?: () => number;
}): AgentRegistryWalkCheckpoint {
  const ref = {
    processName: context.processName,
    projectId: context.projectId,
    processKey: context.processKey,
  };
  const update = async (
    startedAt: number,
    change: (state: AgentRegistryTrafficState, at: number) => AgentRegistryTrafficState,
  ): Promise<void> => {
    const at = now();
    await processStore.transact({
      ref,
      tenantId: context.tenantId,
      sourceEventId: null,
      now: at,
      apply: (current) => {
        if (!current) throw new Error("agent registry traffic process has no state to update");
        const state = agentRegistryTrafficStateSchema.parse(current.state);
        return {
          state: state.walkStartedAt === startedAt ? change(state, at) : state,
          nextWakeAt: current.nextWakeAt,
          messages: [],
        };
      },
    });
  };
  return {
    getProgress: async () => {
      const current = await processStore.findByRef({ ref });
      if (!current) return { walk: "closed" };
      const state = agentRegistryTrafficStateSchema.parse(current.state);
      return state.walkStartedAt === null
        ? { walk: "closed" }
        : {
            walk: "open",
            startedAt: state.walkStartedAt,
            after: state.walkAfter,
            done: state.walkDone,
          };
    },
    save: ({ startedAt, after, done }) =>
      update(startedAt, (state) =>
        done > state.walkDone ? { ...state, walkAfter: after, walkDone: done } : state,
      ),
    complete: ({ startedAt }) =>
      update(startedAt, (state, at) => ({
        ...state,
        lastFullPassAt: at,
        walkStartedAt: null,
        walkAfter: null,
        walkDone: 0,
      })),
  };
}
