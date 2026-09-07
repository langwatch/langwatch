import { useMemo } from "react";
import { useOrganizationTeamProject } from "@langwatch/ui-host/use-organization-team-project";
import { api } from "@langwatch/workflow-web/surfaces/workflow-api";
import type { TargetConfig } from "../../model/experiments-v3/types.ts";
import { type NamedEntity, pickTargetName } from "@langwatch/experiment-contract";

/** Picks the value matching a target's type, defaulting to the evaluator branch. */
function selectByTargetType<T>(
  type: TargetConfig["type"] | undefined,
  values: { prompt: T; agent: T; evaluator: T },
): T {
  if (type === "prompt") return values.prompt;
  if (type === "agent") return values.agent;
  return values.evaluator;
}

/**
 * Hook to fetch the display name for a target from the database.
 * Returns the name from the loaded entity (prompt, agent, or evaluator).
 * Returns empty string while loading.
 */
export const useTargetName = (target: TargetConfig): string => {
  const { project } = useOrganizationTeamProject();

  // Fetch prompt name for prompt targets
  const { data: prompt, isLoading: promptLoading } = api.prompts.getByIdOrHandle.useQuery(
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
  const { data: evaluator, isLoading: evaluatorLoading } = api.evaluators.getById.useQuery(
    {
      id: target.targetEvaluatorId ?? "",
      projectId: project?.id ?? "",
    },
    {
      enabled: target.type === "evaluator" && !!target.targetEvaluatorId && !!project?.id,
    },
  );

  const entity: NamedEntity | undefined =
    selectByTargetType(target.type, { prompt, agent, evaluator }) ?? undefined;
  const isLoading = selectByTargetType(target.type, {
    prompt: promptLoading,
    agent: agentLoading,
    evaluator: evaluatorLoading,
  });

  return pickTargetName({ target, entity, isLoading });
};

/**
 * Batch-fetch display names for several targets at once, in the order given.
 */
export const useTargetNames = (targets: (TargetConfig | undefined)[]): string[] => {
  const { project } = useOrganizationTeamProject();
  const projectId = project?.id ?? "";

  const promptQueries = api.useQueries((t) =>
    targets.map((target) =>
      t.prompts.getByIdOrHandle(
        { idOrHandle: target?.promptId ?? "", projectId },
        {
          enabled: target?.type === "prompt" && !!target.promptId && !!projectId,
          staleTime: 60_000,
        },
      ),
    ),
  );

  const agentQueries = api.useQueries((t) =>
    targets.map((target) =>
      t.agents.getById(
        { id: target?.dbAgentId ?? "", projectId },
        {
          enabled: target?.type === "agent" && !!target.dbAgentId && !!projectId,
          staleTime: 60_000,
        },
      ),
    ),
  );

  const evaluatorQueries = api.useQueries((t) =>
    targets.map((target) =>
      t.evaluators.getById(
        { id: target?.targetEvaluatorId ?? "", projectId },
        {
          enabled: target?.type === "evaluator" && !!target.targetEvaluatorId && !!projectId,
          staleTime: 60_000,
        },
      ),
    ),
  );

  const names = targets.map((target, index) => {
    const query = selectByTargetType(target?.type, {
      prompt: promptQueries[index],
      agent: agentQueries[index],
      evaluator: evaluatorQueries[index],
    });
    return pickTargetName({
      target,
      entity: (query?.data as NamedEntity | null | undefined) ?? undefined,
      isLoading: query?.isLoading ?? false,
    });
  });

  // api.useQueries returns a new array every render, so key the memo on the
  // resolved names themselves rather than on the query objects. JSON.stringify
  // (not join) so distinct lists can't alias to the same key — ["a|b"] and
  // ["a","b"] both join to "a|b" but stringify differently.
  const namesKey = JSON.stringify(names);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => names, [namesKey]);
};
