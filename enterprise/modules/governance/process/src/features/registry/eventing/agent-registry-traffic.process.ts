// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import type { IntentSpec, WakeHandler } from "@langwatch/eventing";
import { z } from "zod";

/**
 * Traffic has no fact of its own to react to, so a scheduled pass re-reads it: every organisation
 * the registry holds is reconciled, which registers newly traced agents and flags them shadow.
 * A pass a day or more after the last completed walk walks every organisation, resuming from the
 * walk's saved cursor. Spec: specs/agent-registry.feature
 */
export const AGENT_REGISTRY_TRAFFIC_PROCESS_NAME = "agentRegistryTraffic" as const;
export const AGENT_REGISTRY_TRAFFIC_INTERVAL_MS = 15 * 60 * 1000;
/** Outbox rows are bookkeeping, one per pass, pruned like every recurring process's. */
const AGENT_REGISTRY_TRAFFIC_ROW_RETENTION_MS = 7 * 24 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export const agentRegistryTrafficPassSchema = z.object({
  scheduledFor: z.number().int(),
  everyOrganization: z.boolean().default(false),
  /** Off until a walk has completed once, so the first walk announces no existing agent. */
  announce: z.boolean().default(true),
});
export const agentRegistryTrafficStateSchema = z.object({
  lastPassAt: z.number().nullable(),
  /** When the last walk over every organisation completed. */
  lastFullPassAt: z.number().nullable().default(null),
  /** Set while a walk is unfinished; the next pass resumes after `walkAfter`. */
  walkStartedAt: z.number().nullable().default(null),
  walkAfter: z.string().nullable().default(null),
});
export type AgentRegistryTrafficState = z.infer<typeof agentRegistryTrafficStateSchema>;
export const AGENT_REGISTRY_TRAFFIC_INITIAL_STATE: AgentRegistryTrafficState = {
  lastPassAt: null,
  lastFullPassAt: null,
  walkStartedAt: null,
  walkAfter: null,
};

export type AgentRegistryTrafficIntents = {
  pass: IntentSpec<typeof agentRegistryTrafficPassSchema>;
};

export const agentRegistryTrafficWake: WakeHandler<
  AgentRegistryTrafficState,
  AgentRegistryTrafficIntents
> = (state, ctx) => {
  const walkDue = state.lastFullPassAt === null || ctx.at - state.lastFullPassAt >= DAY_MS;
  const walkStartedAt = state.walkStartedAt ?? (walkDue ? ctx.at : null);
  const everyOrganization = walkStartedAt !== null;
  return {
    state: { ...state, lastPassAt: ctx.at, walkStartedAt },
    intents: [
      ctx.intent("pass", `pass:${ctx.at}`, {
        scheduledFor: ctx.at,
        everyOrganization,
        announce: state.lastFullPassAt !== null,
      }),
    ],
  };
};

/** Where a walk keeps its progress between passes: the traffic process's own state. */
export interface AgentRegistryWalkCheckpoint {
  /** The unfinished walk's cursor, or `closed` when another pass already finished it. */
  getProgress(): Promise<
    { walk: "open"; startedAt: number; after: string | null } | { walk: "closed" }
  >;
  /** Both write only while the walk that started at `startedAt` is still the open one. */
  save(input: { startedAt: number; after: string }): Promise<void>;
  complete(input: { startedAt: number }): Promise<void>;
}

type TrafficReconcile = (input: {
  everyOrganization: boolean;
  announce: boolean;
  after?: string;
  onPage?: (page: { afterOrganizationId: string }) => Promise<void>;
}) => Promise<{ organizations: number; complete: boolean }>;

/** A walk pass resumes the open walk; one whose walk another pass already finished does nothing. */
async function walkEveryOrganization({
  reconcile,
  announce,
  checkpoint,
}: {
  reconcile: TrafficReconcile;
  announce: boolean;
  checkpoint: AgentRegistryWalkCheckpoint;
}): Promise<void> {
  const progress = await checkpoint.getProgress();
  if (progress.walk === "closed") return;
  const { startedAt, after } = progress;
  const { complete } = await reconcile({
    everyOrganization: true,
    announce,
    ...(after === null ? {} : { after }),
    onPage: ({ afterOrganizationId }) => checkpoint.save({ startedAt, after: afterOrganizationId }),
  });
  if (complete) await checkpoint.complete({ startedAt });
}

/** One pass; a failed organisation is logged and left to the next trigger, never re-driven whole. */
export function runAgentRegistryTraffic(deps: {
  reconcile: TrafficReconcile;
  deleteDispatchedBefore: (params: { processName: string; before: number }) => Promise<number>;
  now: () => number;
}): (
  pass: { everyOrganization: boolean; announce: boolean },
  checkpoint: AgentRegistryWalkCheckpoint,
) => Promise<void> {
  return async ({ everyOrganization, announce }, checkpoint) => {
    const startedAt = deps.now();
    if (everyOrganization) {
      await walkEveryOrganization({ reconcile: deps.reconcile, announce, checkpoint });
    } else {
      await deps.reconcile({ everyOrganization: false, announce });
    }
    await deps
      .deleteDispatchedBefore({
        processName: AGENT_REGISTRY_TRAFFIC_PROCESS_NAME,
        before: startedAt - AGENT_REGISTRY_TRAFFIC_ROW_RETENTION_MS,
      })
      .catch(() => 0);
  };
}
