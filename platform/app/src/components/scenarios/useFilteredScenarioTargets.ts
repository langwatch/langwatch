import { useMemo } from "react";
import type { TargetValue } from "./TargetSelector";

/** Agent types that can be used as scenario targets */
const SCENARIO_AGENT_TYPES: ReadonlySet<string> = new Set([
  "http",
  "code",
  "workflow",
  "connected",
]);

type AgentLike = {
  id: string;
  name: string;
  type: string;
  updatedAt: Date | string;
  config?: unknown;
};

type ScenarioAgentType = "http" | "code" | "workflow" | "connected";

/**
 * Filter and sort agents to only valid scenario target types.
 *
 * Generic over the row, so what the caller read beside the agent, the
 * parameters it declares or its environment, comes back with it.
 */
export function useFilteredAgents<T extends AgentLike>(
  agents: T[] | undefined,
  searchValue: string,
): (T & { type: ScenarioAgentType })[] {
  return useMemo(() => {
    const scenarioAgents = (agents ?? []).filter(
      (a): a is T & { type: ScenarioAgentType } =>
        SCENARIO_AGENT_TYPES.has(a.type),
    );
    const sorted = [...scenarioAgents].sort(
      (a, b) =>
        new Date(b.updatedAt).getTime() - new Date(a.updatedAt).getTime(),
    );
    if (!searchValue) return sorted;
    return sorted.filter((a) =>
      a.name.toLowerCase().includes(searchValue.toLowerCase()),
    );
  }, [agents, searchValue]);
}

/** Type guard: is this target value an agent (HTTP, code, or workflow)? */
export function isAgentTarget(
  target: TargetValue,
): target is NonNullable<TargetValue> & { type: ScenarioAgentType } {
  return target !== null && SCENARIO_AGENT_TYPES.has(target.type);
}
