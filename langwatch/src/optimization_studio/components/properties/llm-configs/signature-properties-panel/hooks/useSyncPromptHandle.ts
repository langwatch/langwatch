import type { Node } from "@xyflow/react";
import { useEffect } from "react";
import { useFormContext } from "react-hook-form";

import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import type { LlmPromptConfigComponent } from "~/optimization_studio/types/dsl";
import type { PromptConfigFormValues } from "~/prompt-configs";
import { versionedPromptToPromptConfigFormValues } from "~/prompt-configs/utils/llmPromptConfigUtils";
import { api } from "~/utils/api";

/**
 * useSyncPromptHandle hook syncs the latest prompt handle and scope via the provided node's config ID
 * Only syncs if the form is not dirty to prevent syncs while editing
 */
export function useSyncPromptHandle(nodeData?: {
  configId?: string;
  handle: string;
}) {
  const { project } = useOrganizationTeamProject();
  const { configId } = nodeData ?? {};
  const formProps = useFormContext<PromptConfigFormValues>();
  const { isDirty } = formProps.formState;

  const {
    data: latestPrompt,
    isLoading: isLoadingLatestPrompt,
    isFetching: isFetchingLatestPrompt,
  } = api.prompts.getByIdOrHandle.useQuery(
    {
      idOrHandle: configId ?? "",
      projectId: project?.id ?? "",
    },
    {
      enabled: !!configId && !!project?.id && !isDirty,
    }
  );

  const isLoading = isLoadingLatestPrompt || isFetchingLatestPrompt;

  useEffect(() => {
    if (!latestPrompt || !configId || isLoading || isDirty) return;

    const currentHandle = formProps.getValues("handle");
    const currentScope = formProps.getValues("scope");
    const latestHandle = latestPrompt.handle;
    const latestScope = latestPrompt.scope;

    // Selective reset of handle and scope depending on the current and latest values
    if (currentHandle !== latestHandle && latestScope !== currentScope) {
      formProps.setValue("handle", latestHandle);
      formProps.setValue("scope", latestScope);
    } else if (currentScope !== latestScope) {
      formProps.setValue("scope", latestScope);
    } else if (currentHandle !== latestHandle) {
      formProps.setValue("handle", latestHandle);
    }
  }, [latestPrompt, configId, formProps, isLoading, isDirty]);
}
