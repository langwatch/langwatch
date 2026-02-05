import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import type { TargetConfig } from "../types";

/**
 * Hook to fetch the display name for a target from the database.
 * Returns the name from the loaded entity (prompt, agent, or evaluator).
 * Returns empty string while loading.
 */
export const useTargetName = (target: TargetConfig): string => {
  const { project } = useOrganizationTeamProject();

  // Fetch prompt name for prompt targets
  const { data: prompt, isLoading: promptLoading } =
    api.prompts.getByIdOrHandle.useQuery(
      {
        idOrHandle: target.promptId ?? "",
        projectId: project?.id ?? "",
      },
      {
        enabled: target.type === "prompt" && !!target.promptId && !!project?.id,
      },
    );

  // Fetch agent name for agent targets
  const { data: agent, isLoading: agentLoading } = api.agents.getById.useQuery(
    {
      id: target.dbAgentId ?? "",
      projectId: project?.id ?? "",
    },
    {
      enabled: target.type === "agent" && !!target.dbAgentId && !!project?.id,
    },
  );

  // Fetch evaluator name for evaluator targets
  const { data: evaluator, isLoading: evaluatorLoading } =
    api.evaluators.getById.useQuery(
      {
        id: target.targetEvaluatorId ?? "",
        projectId: project?.id ?? "",
      },
      {
        enabled:
          target.type === "evaluator" &&
          !!target.targetEvaluatorId &&
          !!project?.id,
      },
    );

  // Return empty string while loading, then the name once loaded
  if (target.type === "prompt") {
    if (target.promptId && promptLoading) return "";
    return target.promptId ? prompt?.handle ?? "" : "New Prompt";
  }
  if (target.type === "agent") {
    if (agentLoading) return "";
    return agent?.name ?? "";
  }
  if (target.type === "evaluator") {
    if (evaluatorLoading) return "";
    return evaluator?.name ?? "";
  }

  return "";
};
