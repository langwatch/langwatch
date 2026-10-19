import type { TargetConfig } from "../experiment-workbench.ts";

/** What a name lookup yields, whichever entity it fetched. */
export type NamedEntity = { name?: string | null; handle?: string | null };

// Single source of truth for target display names: handles for prompts, then
// names, then "New Prompt" placeholder. One implementation keeps frontend and
// server orchestrator agree. Empty string means "not known yet".
export const pickTargetName = ({
  target,
  entity,
  isLoading,
}: {
  target: TargetConfig | undefined;
  entity: NamedEntity | undefined;
  isLoading: boolean;
}): string => {
  if (!target) return "";
  if (target.type === "prompt") {
    if (!target.promptId) return "New Prompt";
    if (isLoading) return "";
    return entity?.handle ?? entity?.name ?? "New Prompt";
  }
  if (target.type === "agent" || target.type === "evaluator") {
    if (isLoading) return "";
    return entity?.name ?? "";
  }
  return "";
};
