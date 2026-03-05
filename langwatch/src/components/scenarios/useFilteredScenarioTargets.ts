import { useMemo } from "react";
import type { TargetValue } from "./TargetSelector";

/** Agent types that can be used as scenario targets */
const SCENARIO_AGENT_TYPES: ReadonlySet<string> = new Set(["http", "code"]);

type AgentLike = {
  id: string;
  name: string;
  type: string;
  updatedAt: Date | string;
};

type ScenarioAgent = AgentLike & { type: "http" | "code" };

/** Filter and sort agents to only valid scenario target types (HTTP + code). */
export function useFilteredAgents(
  agents: AgentLike[] | undefined,
  searchValue: string,
): ScenarioAgent[] {
  return useMemo(() => {
    const scenarioAgents = (agents ?? []).filter(
      (a): a is ScenarioAgent => SCENARIO_AGENT_TYPES.has(a.type),
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

/** Type guard: is this target value an agent (HTTP or code)? */
export function isAgentTarget(
  target: TargetValue,
): target is NonNullable<TargetValue> & { type: "http" | "code" } {
  return target !== null && SCENARIO_AGENT_TYPES.has(target.type);
}
