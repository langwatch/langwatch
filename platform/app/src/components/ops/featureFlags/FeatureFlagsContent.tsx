import { Center, Spinner } from "@chakra-ui/react";
import { OperatorFeatureFlagCatalogueView } from "@langwatch/feature-flag-web";
import { HandledErrorAlert, showErrorToast } from "~/features/errors";
import { useOpsPermission } from "~/hooks/useOpsPermission";
import { api } from "~/utils/api";

export function FeatureFlagsContent() {
  const { scope } = useOpsPermission();
  const canManage = scope?.kind === "platform";
  const query = api.ops.listFeatureFlags.useQuery(undefined, {
    refetchInterval: 30_000,
  });
  const utils = api.useUtils();
  const setFlag = api.ops.setFeatureFlag.useMutation({
    onSuccess: async () => utils.ops.listFeatureFlags.invalidate(),
    onError: (error) => showErrorToast({ error, fallbackTitle: "Couldn't update the flag" }),
  });
  const clearFlag = api.ops.clearFeatureFlag.useMutation({
    onSuccess: async () => utils.ops.listFeatureFlags.invalidate(),
    onError: (error) => showErrorToast({ error, fallbackTitle: "Couldn't clear the override" }),
  });
  const setRules = api.ops.setFeatureFlagRules.useMutation({
    onSuccess: async () => utils.ops.listFeatureFlags.invalidate(),
    onError: (error) => {
      showErrorToast({ error, fallbackTitle: "Couldn't save the targeting rules" });
    },
  });

  if (query.isLoading) {
    return (
      <Center paddingY={20}>
        <Spinner />
      </Center>
    );
  }

  if (query.error) {
    return (
      <Center paddingY={20}>
        <HandledErrorAlert error={query.error} fallbackTitle="Couldn't load feature flags" />
      </Center>
    );
  }

  return (
    <OperatorFeatureFlagCatalogueView
      catalogue={query.data ?? { flags: [], families: [] }}
      canManage={canManage}
      pendingKey={
        (setFlag.isPending ? setFlag.variables?.key : void 0) ??
        (clearFlag.isPending ? clearFlag.variables?.key : void 0) ??
        (setRules.isPending ? setRules.variables?.key : void 0)
      }
      onSetEnabled={async (input) => {
        await setFlag.mutateAsync(input);
      }}
      onClear={async (input) => {
        await clearFlag.mutateAsync(input);
      }}
      onSetRules={async (input) => {
        await setRules.mutateAsync(input);
      }}
    />
  );
}
