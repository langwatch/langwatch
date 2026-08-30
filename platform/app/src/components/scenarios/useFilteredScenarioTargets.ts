/**
 * The agents a simulation can be pointed at, and what each of them reads as.
 *
 * A connected agent is one of them (ADR-128): it carries an environment, a
 * presence and, in a development environment, an owner. A development agent
 * that belongs to another person can only be run by that person, so it is
 * kept out of the picker until the reader asks for it and is never
 * selectable.
 *
 * @see specs/features/agents/connected-agents-ui.feature
 */

import { useMemo } from "react";
import { explainHandledError } from "~/features/errors";
import { targetLabelOf } from "~/server/suites/target-key";
import type { TargetValue } from "./TargetSelector";

/** What the switch that reveals other people's development agents reads. */
export const TEAMMATES_TOGGLE_LABEL = "Show teammates' development agents";

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
export type ScenarioAgent = AgentLike & {
  type: ScenarioAgentType;
  /** What the card and the option read: the name, and the environment. */
  label: string;
  /** True when a development agent belongs to another person. */
  belongsToTeammate: boolean;
  /** False only for a development agent of another person. */
  runnable: boolean;
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

/** True when this agent is a personal development agent of another person. */
export function belongsToTeammate({
  agent,
  viewerUserId,
}: {
  agent: AgentLike;
  viewerUserId?: string | null;
}): boolean {
  const ownerId = agent.owner?.userId;
  if (!ownerId) return false;
  return ownerId !== viewerUserId;
}

/** The agents of the project as targets, newest first, filtered by the search. */
export function scenarioAgentsOf({
  agents,
  searchValue,
  viewerUserId,
}: {
  agents: AgentLike[] | undefined;
  searchValue: string;
  viewerUserId?: string | null;
}): ScenarioAgent[] {
  const scenarioAgents = (agents ?? [])
    .filter((agent): agent is AgentLike & { type: ScenarioAgentType } =>
      SCENARIO_AGENT_TYPES.has(agent.type),
    )
    .map((agent): ScenarioAgent => {
      const teammates = belongsToTeammate({ agent, viewerUserId });
      return {
        ...agent,
        label: agentTargetLabel(agent),
        belongsToTeammate: teammates,
        runnable: !teammates,
      };
    });
  const sorted = [...scenarioAgents].sort(
    (a, b) => new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
  );
  if (!searchValue) return sorted;
  const needle = searchValue.toLowerCase();
  return sorted.filter((agent) => agent.label.toLowerCase().includes(needle));
}

/**
 * The agents the picker draws.
 *
 * A teammate's development agent is out until the toggle asks for it, and it
 * is drawn disabled when it is in, because only its owner can run it.
 */
export function offeredAgents<T extends { belongsToTeammate?: boolean }>({
  agents,
  showTeammates,
}: {
  agents: readonly T[];
  showTeammates: boolean;
}): T[] {
  return showTeammates
    ? [...agents]
    : agents.filter((agent) => !agent.belongsToTeammate);
}

/** True when the project holds a development agent of another person. */
export function hasTeammateAgents(
  agents: readonly { belongsToTeammate?: boolean }[],
): boolean {
  return agents.some((agent) => agent.belongsToTeammate === true);
}

/** Filter and sort agents to only valid scenario target types. */
export function useFilteredAgents({
  agents,
  searchValue,
  viewerUserId,
}: {
  agents: AgentLike[] | undefined;
  searchValue: string;
  viewerUserId?: string | null;
}): ScenarioAgent[] {
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

/**
 * Why a teammate's development agent cannot be picked, in the words the
 * product already uses for that refusal.
 *
 * Read from the code-keyed registry rather than written again here, so the
 * picker and the refused run say the same thing.
 */
export function ownerOnlyCopy(ownerName?: string | null): string {
  const explanation = explainHandledError({
    code: "agent_owner_only",
    meta: ownerName ? { ownerName } : {},
    httpStatus: 403,
    fault: "customer",
    tips: [],
    docsUrl: undefined,
    traceId: undefined,
    reasons: [],
  });
  return explanation.description || explanation.title;
}
