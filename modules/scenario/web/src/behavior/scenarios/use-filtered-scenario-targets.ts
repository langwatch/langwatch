/**
 * The agents a simulation can be pointed at, and what each of them reads as.
 * @see specs/features/agents/connected-agents-ui.feature
 */

import { useMemo } from "react";
import { connectedAgentSelectability } from "@langwatch/agent-contract";
import { targetLabelOf } from "@langwatch/suite-contract";
import type { TargetValue } from "../../model/scenario-target.ts";

/** Agent types that can be used as scenario targets */
const SCENARIO_AGENT_TYPES: ReadonlySet<string> = new Set([
  "http",
  "code",
  "workflow",
  "connected",
]);

/** What the picker reads off an agent row. */
export type AgentLike = {
  id: string;
  name: string;
  type: string;
  updatedAt: Date | string;
  config?: unknown;
  /** The environment of a connected agent; nothing for the other kinds. */
  environment?: string | null;
  /** Whether a process is holding a connected agent right now. */
  status?: "online" | "offline";
  /** The owner of a personal development agent. */
  owner?: { userId: string; name: string | null } | null;
};

export type ScenarioAgentType = "http" | "code" | "workflow" | "connected";

/** One agent as the picker offers it. */
export type ScenarioAgent<T extends AgentLike = AgentLike> = T & {
  type: ScenarioAgentType;
  /** What the card and the option read: the name, and the environment. */
  label: string;
  /** True when a development agent belongs to another person. */
  isTeammateOwned: boolean;
  /** False only for a development agent of another person. */
  isRunnable: boolean;
};

/** The label of one agent: its name, and the environment of a connected one. */
export function agentTargetLabel(agent: AgentLike): string {
  return targetLabelOf({
    name: agent.name,
    environment: agent.environment,
    ownerName: agent.owner?.name,
    differingNames: new Set<string>(),
  });
}

/**
 * True when this agent is a personal development agent of another person.
 *
 * The same rule the listings mark their rows with and the run refuses on, so
 * the picker never offers a target the run would refuse.
 */
export function isTeammateOwned({
  agent,
  viewerUserId,
}: {
  agent: AgentLike;
  viewerUserId?: string | null;
}): boolean {
  return !connectedAgentSelectability({
    ownerUserId: agent.owner?.userId ?? null,
    viewerUserId,
  }).selectable;
}

/** The agents of the project as targets, newest first, filtered by the search. */
export function scenarioAgentsOf<T extends AgentLike>({
  agents,
  searchValue,
  viewerUserId,
}: {
  agents: T[] | undefined;
  searchValue: string;
  viewerUserId?: string | null;
}): ScenarioAgent<T>[] {
  const scenarioAgents = (agents ?? [])
    .filter((agent): agent is T & { type: ScenarioAgentType } =>
      SCENARIO_AGENT_TYPES.has(agent.type),
    )
    .map((agent): ScenarioAgent<T> => {
      const teammates = isTeammateOwned({ agent, viewerUserId });
      return {
        ...agent,
        label: agentTargetLabel(agent),
        isTeammateOwned: teammates,
        isRunnable: !teammates,
      };
    });
  const sorted = [...scenarioAgents].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  );
  if (!searchValue) return sorted;
  const needle = searchValue.toLowerCase();
  return sorted.filter((agent) => agent.label.toLowerCase().includes(needle));
}

/** Filter and sort agents to only valid scenario target types. */
export function useFilteredAgents<T extends AgentLike>({
  agents,
  searchValue,
  viewerUserId,
}: {
  agents: T[] | undefined;
  searchValue: string;
  viewerUserId?: string | null;
}): ScenarioAgent<T>[] {
  return useMemo(
    () => scenarioAgentsOf({ agents, searchValue, viewerUserId }),
    [agents, searchValue, viewerUserId],
  );
}

/** Type guard: is this target value an agent rather than a prompt? */
export function isAgentTarget(
  target: TargetValue,
): target is NonNullable<TargetValue> & { type: ScenarioAgentType } {
  return target !== null && SCENARIO_AGENT_TYPES.has(target.type);
}
