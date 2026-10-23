import { api } from "../../../behavior/ops-api.ts";
import { useShowErrorToast } from "../../../behavior/ops-feedback.ts";

/**
 * Mints a five-minute link to one report's bundle and opens it; a refusal names its code. The
 * tab opens inside the click, before the link exists, since a browser blocks a tab opened later.
 */
export function useUpgradeDiagnosticsDownload() {
  const showErrorToast = useShowErrorToast();
  const mutation = api.selfHostedInstances.getDiagnosticsDownload.useMutation();
  return {
    download: (id: string) => {
      const tab = window.open("about:blank", "_blank");
      if (tab) tab.opener = null;
      mutation.mutate(
        { id },
        {
          onSuccess: ({ url }) => {
            if (tab) tab.location.href = url;
            else window.location.assign(url);
          },
          onError: (error: unknown) => {
            tab?.close();
            showErrorToast({ error, fallbackTitle: "The diagnostics could not be downloaded" });
          },
        },
      );
    },
    downloadingId: mutation.isPending ? (mutation.variables?.id ?? null) : null,
  };
}
