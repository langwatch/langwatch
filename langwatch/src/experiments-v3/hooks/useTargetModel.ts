import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";
import type { TargetConfig } from "../types";

/**
 * Model for a prompt target, used to disambiguate pairwise variants that
 * share the same display name (see `disambiguateVariantNames`). Unpublished
 * edits carry the model directly on the target; published prompts fall back
 * to the same prompt query `useTargetName` already issues (deduped by
 * react-query, not an extra request).
 *
 * Returns undefined for non-prompt targets and while loading.
 */
export const useTargetModel = (target: TargetConfig): string | undefined => {
  const { project } = useOrganizationTeamProject();

  const localModel = target.localPromptConfig?.llm?.model;

  const { data: prompt } = api.prompts.getByIdOrHandle.useQuery(
    {
      idOrHandle: target.promptId ?? "",
      projectId: project?.id ?? "",
    },
    {
      enabled:
        target.type === "prompt" &&
        !!target.promptId &&
        !!project?.id &&
        !localModel,
    },
  );

  if (target.type !== "prompt") return undefined;
  return localModel ?? prompt?.model;
};
