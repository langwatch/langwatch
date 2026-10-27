import { api } from "../../../behavior/ops-api.ts";
import { useOpsToaster } from "../../../behavior/ops-feedback.ts";

/** `ops.upgrade.retryStep` for the drawer and the background list; success re-reads them all. */
export function useRetryUpgradeStep() {
  const utils = api.useUtils();
  const toaster = useOpsToaster();
  const retry = api.ops.upgrade.retryStep.useMutation({
    onSuccess: () => void utils.ops.upgrade.invalidate(),
    onError: () => toaster.create({ type: "error", title: "The step could not be retried" }),
  });
  return {
    retryStep: (id: string) => retry.mutate({ id }),
    retryingStepId: retry.isPending ? (retry.variables?.id ?? null) : null,
  };
}
