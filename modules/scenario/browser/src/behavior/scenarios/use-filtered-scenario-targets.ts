/**
 * The agents a simulation can be pointed at, and what each reads as. A
 * connected agent is one of them (ADR-128): unowned or unheld, it can't be
 * run, so the picker draws it disabled and says why on hover.
 * @see specs/features/agents/connected-agents-ui.feature
 */

import { connectedAgentSelectability, ownerOnlyCopy } from "@langwatch/agent-contract";
import { targetLabelOf } from "@langwatch/suite-contract";
import { toEpochMs, type Instant } from "@langwatch/time";
import { useMemo } from "react";

import type { TargetValue } from "../../model/scenario-target.ts";

/**
 * Read where the action is choosing a run target: the run dialog target
 * picker, the scenario target selector and the Save and run menu.
 */
export const OFFLINE_AGENT_SELECT_COPY =
  "This agent is offline. Start the process that runs it to be able to select it.";

/** Why a run plan or suite draws a Scenario Connector agent disabled. */
export const SUITE_CONNECTOR_SELECT_COPY = "Suites cannot target a Scenario Connector yet";

/** Agent types that can be used as scenario targets */
const SCENARIO_AGENT_TYPES: ReadonlySet<string> = new Set([
  "http",
  "code",
  "workflow",
  "connected",
  "voice",
  "connector",
]);

/** What the picker reads off an agent row. */
export type AgentLike = {
  id: string;
  name: string;
  type: string;
  updatedAt: Instant | string;
  config?: unknown;
  /** The environment of a connected agent; nothing for the other kinds. */
  environment?: string | null;
  /** Whether a process is holding a connected agent right now. */
  status?: "online" | "offline";
  /** The owner of a personal development agent. */
  owner?: { userId: string; name: string | null } | null;
};

export type ScenarioAgentType = "http" | "code" | "workflow" | "connected" | "voice" | "connector";

/** One agent as the picker offers it. */
export type ScenarioAgent<T extends AgentLike = AgentLike> = T & {
  type: ScenarioAgentType;
  /** What the card and the option read: the name, and the environment. */
  label: string;
  /** True when a development agent belongs to another person. */
  isTeammateOwned: boolean;
  /** True when a connected agent has no process holding it. */
  isOffline: boolean;
  /** True when the picker feeds a suite run and the agent is a Scenario Connector. */
  isRefusedBySuite: boolean;
  /** False for another person's development agent, an offline agent and one a suite refuses. */
  isRunnable: boolean;
};

/** True when this agent is a connected agent that no process is holding. */
export function isOfflineAgent(agent: Pick<AgentLike, "type" | "status">): boolean {
  return agent.type === "connected" && agent.status === "offline";
}

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
 * True when this agent is a personal development agent of another person —
 * the same rule the listings mark rows with and the run refuses on, so the
 * picker never offers a target the run would refuse.
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

function targetUpdatedAtMs(value: AgentLike["updatedAt"]): number {
  return typeof value === "string" ? toEpochMs(value) : value.epochMilliseconds;
}

/**
 * The agents of the project as targets, newest first, filtered by the search.
 * `forSuite` is set where the run goes out as a run plan or suite, which cannot
 * target a Scenario Connector yet (suiteTargetTypeSchema), so one is drawn disabled.
 */
export function scenarioAgentsOf<T extends AgentLike>({
  agents,
  searchValue,
  viewerUserId,
  forSuite = false,
}: {
  agents: T[] | undefined;
  searchValue: string;
  viewerUserId?: string | null;
  forSuite?: boolean;
}): ScenarioAgent<T>[] {
  const scenarioAgents = (agents ?? [])
    .filter((agent): agent is T & { type: ScenarioAgentType } =>
      SCENARIO_AGENT_TYPES.has(agent.type),
    )
    .map((agent): ScenarioAgent<T> => {
      const teammates = isTeammateOwned({ agent, viewerUserId });
      const offline = isOfflineAgent(agent);
      const refusedBySuite = forSuite && agent.type === "connector";
      return {
        ...agent,
        label: agentTargetLabel(agent),
        isTeammateOwned: teammates,
        isOffline: offline,
        isRefusedBySuite: refusedBySuite,
        isRunnable: !teammates && !offline && !refusedBySuite,
      };
    });
  const sorted = [...scenarioAgents].toSorted(
    (a, b) => targetUpdatedAtMs(b.updatedAt) - targetUpdatedAtMs(a.updatedAt),
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
  forSuite = false,
}: {
  agents: T[] | undefined;
  searchValue: string;
  viewerUserId?: string | null;
  /** Set where the run goes out as a run plan or suite; see {@link scenarioAgentsOf}. */
  forSuite?: boolean;
}): ScenarioAgent<T>[] {
  return useMemo(
    () => scenarioAgentsOf({ agents, searchValue, viewerUserId, forSuite }),
    [agents, searchValue, viewerUserId, forSuite],
  );
}

/**
 * The target a run plan or suite may open on. A Scenario Connector pick, remembered
 * from a single scenario run, is dropped: a suite cannot target one yet.
 */
export function suiteTargetOf(target: TargetValue): TargetValue {
  return target?.type === "connector" ? null : target;
}

/** Type guard: is this target value an agent rather than a prompt? */
export function isAgentTarget(
  target: TargetValue,
): target is NonNullable<TargetValue> & { type: ScenarioAgentType } {
  return target !== null && SCENARIO_AGENT_TYPES.has(target.type);
}

/**
 * Why an agent cannot be picked as a run target. A suite's refusal of a
 * connector comes first; then a development agent of another person, which
 * the reader can never run, even when it is offline too.
 */
export function notRunnableCopy(agent: {
  isTeammateOwned?: boolean;
  owner?: { name: string | null } | null;
  isOffline?: boolean;
  isRefusedBySuite?: boolean;
}): string {
  if (agent.isRefusedBySuite) return SUITE_CONNECTOR_SELECT_COPY;
  if (agent.isOffline && !agent.isTeammateOwned) {
    return OFFLINE_AGENT_SELECT_COPY;
  }
  return ownerOnlyCopy(agent.owner?.name);
}
