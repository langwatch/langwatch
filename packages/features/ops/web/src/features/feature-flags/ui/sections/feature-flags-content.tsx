import { Center, Spinner } from "@chakra-ui/react";
import { OperatorFeatureFlagCatalogueView } from "@langwatch/feature-flag-web";
import { HandledErrorAlert } from "../../../../ui/elements/ops-handled-error-alert";
import { useOpsPermission } from "../../../../behavior/ops-session";
import { useOpsHost } from "../../../../model/ops-host";
import { api } from "../../../../behavior/ops-api";

import { useShowErrorToast } from "../../../../behavior/ops-feedback";
export function FeatureFlagsContent() {
  const showErrorToast = useShowErrorToast();
  const { scope } = useOpsPermission();
  const host = useOpsHost();
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
      sharedInstall={host.sharedInstall()}
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
