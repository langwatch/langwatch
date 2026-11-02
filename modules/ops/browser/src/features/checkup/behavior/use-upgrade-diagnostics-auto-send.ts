import { createModuleApi, type ContractApiMap } from "@langwatch/api/web";
/**
 * The automatic upgrade diagnostics switch on Settings, Checkup: install-wide and install-admin
 * only, so it is not asked for anyone else. Spec: modules/ops/specs/upgrade-alerts.feature
 */
import type { checkupTrpc } from "@langwatch/ops-contract";

import { useCheckupHost } from "../model/checkup-host.ts";

const checkupApi = createModuleApi<ContractApiMap<typeof checkupTrpc>>();

export function useUpgradeDiagnosticsAutoSend({
  organizationId,
  canManageInstall,
}: {
  organizationId: string;
  canManageInstall: boolean;
}) {
  const host = useCheckupHost();
  const autoSend = checkupApi.checkup.upgradeDiagnosticsAutoSend.useQuery(
    { organizationId },
    { enabled: !!organizationId && canManageInstall, refetchOnWindowFocus: false },
  );
  const setAutoSend = checkupApi.checkup.setUpgradeDiagnosticsAutoSend.useMutation({
    onSuccess: () => void autoSend.refetch(),
    onError: (error: unknown) =>
      host.failed({ error, fallbackTitle: "Couldn't change automatic diagnostics" }),
  });

  return {
    autoSend: autoSend.data?.deployment === "self-hosted" ? autoSend.data : undefined,
    isSaving: setAutoSend.isPending,
    setEnabled: (enabled: boolean) => setAutoSend.mutate({ organizationId, enabled }),
  };
}
