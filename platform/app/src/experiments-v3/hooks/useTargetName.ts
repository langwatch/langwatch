import { useMemo } from "react";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import type { TargetConfig } from "../types";

/** What a name query yields, whichever entity it fetched. */
type NamedEntity = { name?: string | null; handle?: string | null };

/**
 * Pick a target's display name from its already-fetched entity. Pure, so the
 * single-target and batched hooks below cannot drift apart.
 *
 * Prompts prefer the globally-unique handle, then the plain name (always
 * present on LlmPromptConfig), then "New Prompt" — a placeholder prompt with
 * no handle yet should still render a label. An empty string means "loading".
 */
const pickTargetName = ({
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

  const entity: NamedEntity | undefined =
    (target.type === "prompt"
      ? prompt
      : target.type === "agent"
        ? agent
        : evaluator) ?? undefined;
  const isLoading =
    target.type === "prompt"
      ? promptLoading
      : target.type === "agent"
        ? agentLoading
        : evaluatorLoading;

  return pickTargetName({ target, entity, isLoading });
};

/**
 * Batch-fetch display names for several targets at once, in the order given.
 *
 * A comparison column needs every variant's name to pick the winner and to
 * disambiguate same-name variants, and `useTargetName` cannot be called once
 * per variant from a loop. These queries use the same cache keys as the
 * variants' own column headers, so they resolve from cache without refetching.
 *
 * Undefined slots (a variant whose target was removed) resolve to "".
 */
export const useTargetNames = (
  targets: (TargetConfig | undefined)[],
): string[] => {
  const { project } = useOrganizationTeamProject();
  const projectId = project?.id ?? "";

  const promptQueries = api.useQueries((t) =>
    targets.map((target) =>
      t.prompts.getByIdOrHandle(
        { idOrHandle: target?.promptId ?? "", projectId },
        {
          enabled:
            target?.type === "prompt" && !!target.promptId && !!projectId,
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
          enabled:
            target?.type === "evaluator" &&
            !!target.targetEvaluatorId &&
            !!projectId,
          staleTime: 60_000,
        },
      ),
    ),
  );

  const names = targets.map((target, index) => {
    const query =
      target?.type === "prompt"
        ? promptQueries[index]
        : target?.type === "agent"
          ? agentQueries[index]
          : evaluatorQueries[index];
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
