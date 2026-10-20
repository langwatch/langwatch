import { api } from "../../../behavior/ops-api.ts";
import { useShowErrorToast } from "../../../behavior/ops-feedback.ts";

/** Mints a five-minute link to one report's bundle and opens it; a refusal names its code. */
export function useUpgradeDiagnosticsDownload() {
  const showErrorToast = useShowErrorToast();
  const mutation = api.selfHostedInstances.getDiagnosticsDownload.useMutation({
    onSuccess: ({ url }) => {
      window.open(url, "_blank", "noopener,noreferrer");
    },
    onError: (error: unknown) =>
      showErrorToast({ error, fallbackTitle: "The diagnostics could not be downloaded" }),
  });
  return {
    download: (id: string) => mutation.mutate({ id }),
    downloadingId: mutation.isPending ? (mutation.variables?.id ?? null) : null,
  };
}
