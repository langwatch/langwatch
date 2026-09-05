import { useCallback } from "react";
import { useTargetNameMap } from "../use-target-name-map";
import type { TargetConfig } from "../../model/experiments-v3/types";

/**
 * Returns a resolver that maps a target to its human-readable display name (prompt
 * handle / agent name), falling back to the internal target id when the name has not
 * loaded yet or the entity is unknown.
 */
export function useResolveTargetName(): (
  target: Pick<TargetConfig, "id" | "promptId" | "dbAgentId" | "targetEvaluatorId">,
) => string {
  const nameMap = useTargetNameMap();

  return useCallback(
    (target) => {
      const entityId = target.promptId ?? target.dbAgentId ?? target.targetEvaluatorId;
      return (entityId && nameMap.get(entityId)) || target.id;
    },
    [nameMap],
  );
}
