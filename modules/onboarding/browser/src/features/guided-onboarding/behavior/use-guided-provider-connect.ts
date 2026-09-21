/**
 * The provider takeover step's own writes: records the connection once the
 * shared credential form has saved a row (pointing Langy's own role at the
 * connected model first, same as upstream), or records a skip.
 */
import { useModelProvidersSettings } from "@langwatch/model-provider-browser/surfaces/model-provider-settings";
import { useCallback } from "react";

import { onboardingApi } from "../../../behavior/onboarding-api.ts";
import type { GuidedProvider } from "../model/guided-providers.ts";

export interface GuidedConnectedProvider {
  provider: string;
  model: string;
}

type StoredProviderRow = {
  models?: string[] | null;
  customModels?: { modelId: string }[] | null;
};

/** The model a just-saved row carries: a picked chat model, or the one typed in manually. */
function connectedModel(row: StoredProviderRow | undefined): string {
  return row?.customModels?.[0]?.modelId ?? row?.models?.[0] ?? "";
}

export function useGuidedProviderConnect({
  organizationId,
  projectId,
  onConnected,
}: {
  organizationId: string;
  projectId: string | undefined;
  onConnected: (connected: GuidedConnectedProvider) => void;
}) {
  const { refetch } = useModelProvidersSettings({ projectId });
  const recordProvider = onboardingApi.onboarding.recordProvider.useMutation();
  const recordProviderSkipped = onboardingApi.onboarding.recordProviderSkipped.useMutation();
  const setRoleAssignment = onboardingApi.modelProvider.setRoleAssignmentForScope.useMutation();

  const onSaved = useCallback(
    async (provider: GuidedProvider) => {
      const refetched = await refetch();
      const providers = refetched.data as Record<string, StoredProviderRow> | undefined;
      const model = connectedModel(providers?.[provider.registryKey]);
      await setRoleAssignment.mutateAsync({
        scopeType: "ORGANIZATION",
        scopeId: organizationId,
        role: "LANGY",
        model: `${provider.registryKey}/${model}`,
      });
      await recordProvider.mutateAsync({
        organizationId,
        provider: provider.registryKey,
        model,
      });
      onConnected({ provider: provider.registryKey, model });
    },
    [refetch, setRoleAssignment, recordProvider, organizationId, onConnected],
  );

  const skip = useCallback(
    () => recordProviderSkipped.mutateAsync({ organizationId }),
    [recordProviderSkipped, organizationId],
  );

  return { onSaved, skip, isSaving: recordProvider.isPending };
}
