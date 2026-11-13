// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { IntentContext, ProcessStore } from "@langwatch/eventing";
import { nowInstant } from "@langwatch/time";

import {
  type AgentRegistryTrafficState,
  agentRegistryTrafficStateSchema,
  type AgentRegistryWalkCheckpoint,
} from "./agent-registry-traffic.process.ts";

/** The walk's progress, read and written in the traffic process's own state row. */
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
        return {
          state: change(agentRegistryTrafficStateSchema.parse(current.state), at),
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
        : { walk: "open", after: state.walkAfter };
    },
    save: ({ after }) => update((state) => ({ ...state, walkAfter: after })),
    complete: () =>
      update((state, at) => ({
        ...state,
        lastFullPassAt: at,
        walkStartedAt: null,
        walkAfter: null,
      })),
  };
}
