import { useEffect, useCallback } from "react";
import { useFormContext } from "react-hook-form";

import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import type { PromptConfigFormValues } from "~/prompts";
import { api } from "~/utils/api";

/**
 * useSyncPromptHandle hook syncs the latest prompt handle and scope via the provided node's config ID
 * Only syncs if the form is not dirty to prevent syncs while editing
 */
export function useSyncPromptHandle(nodeData?: { configId?: string | null }) {
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
  const shouldSync = !isLoading && !isDirty && !!configId;

  /**
   * Sets the value of the form without triggering a change event
   * Blocks null values from being set
   */
  const setNicely = useCallback(
    (key: keyof PromptConfigFormValues, value: string | null) => {
      if (!value) return;
      formProps.setValue(key, value, {
        shouldDirty: false,
        shouldTouch: false,
        shouldValidate: false,
      });
    },
    [formProps]
  );

  useEffect(() => {
    if (!shouldSync || !latestPrompt) return;

    const currentHandle = formProps.getValues("handle");
    const currentScope = formProps.getValues("scope");
    const latestHandle = latestPrompt.handle;
    const latestScope = latestPrompt.scope;

    // Selective reset of handle and scope depending on the current and latest values
    if (currentHandle !== latestHandle && latestScope !== currentScope) {
      setNicely("handle", latestHandle);
      setNicely("scope", latestScope);
    } else if (currentScope !== latestScope) {
      setNicely("scope", latestScope);
    } else if (currentHandle !== latestHandle) {
      setNicely("handle", latestHandle);
    }
  }, [latestPrompt, configId, formProps, shouldSync, setNicely]);
}
