import { useCallback } from "react";
import { useTargetNameMap } from "~/hooks/useTargetNameMap";
import type { TargetConfig } from "../types";

/**
 * Returns a resolver that maps a target to its human-readable display name
 * (prompt handle / agent name), falling back to the internal target id when
 * the name has not loaded yet or the entity is unknown.
 *
 * Used so variable-mapping sources show "category_classifier.l3" instead of
 * "target_1778838627724.l3".
 */
export function useResolveTargetName(): (
  target: Pick<
    TargetConfig,
    "id" | "promptId" | "dbAgentId" | "targetEvaluatorId"
  >,
) => string {
  const nameMap = useTargetNameMap();

  return useCallback(
    (target) => {
      const entityId =
        target.promptId ?? target.dbAgentId ?? target.targetEvaluatorId;
      return (entityId && nameMap.get(entityId)) || target.id;
    },
    [nameMap],
  );
}
