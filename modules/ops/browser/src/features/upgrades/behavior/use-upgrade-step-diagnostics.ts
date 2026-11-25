import type { UpgradeDiagnosticsBundle } from "@langwatch/ops-contract";
import { useState } from "react";

import { api } from "../../../behavior/ops-api.ts";
import { useOpsToaster } from "../../../behavior/ops-feedback.ts";
import { useOpsHost } from "../../../model/ops-host.ts";

/** `upgrade-diagnostics-<step>.json`, the step id made safe for a file name. */
export const diagnosticsFileName = (stepId: string) =>
  `upgrade-diagnostics-${stepId.replace(/[^a-z0-9-]+/gi, "-")}.json`;

/**
 * One step's diagnostics for the drawer: copy and download the bundle, and send it to LangWatch
 * after the operator has seen it. Spec: modules/ops/specs/upgrade-diagnostics.feature
 */
export function useUpgradeStepDiagnostics({ stepId }: { stepId: string }) {
  const utils = api.useUtils();
  const host = useOpsHost();
  const toaster = useOpsToaster();
  const availability = api.ops.upgrade.diagnosticsAvailability.useQuery();
  const [preview, setPreview] = useState<{
    text: string;
    bundle: UpgradeDiagnosticsBundle;
  } | null>(null);
  const send = api.ops.upgrade.sendDiagnostics.useMutation({
    onSuccess: () => {
      setPreview(null);
      toaster.create({ type: "success", title: "Sent to the LangWatch team" });
    },
    onError: (error) => host.failed({ error, fallbackTitle: "The diagnostics could not be sent" }),
  });

  const whenRead =
    (act: (text: string, bundle: UpgradeDiagnosticsBundle) => void | Promise<void>) => async () => {
      try {
        const bundle = await utils.ops.upgrade.getDiagnostics.fetch({ id: stepId });
        await act(JSON.stringify(bundle, null, 2), bundle);
      } catch (error) {
        host.failed({ error, fallbackTitle: "The diagnostics could not be read" });
      }
    };

  return {
    canSend: availability.data?.available ?? false,
    copy: whenRead(async (text) => {
      await navigator.clipboard.writeText(text);
      toaster.create({ type: "success", title: "Diagnostics copied" });
    }),
    download: whenRead((text) => {
      const url = URL.createObjectURL(new Blob([text], { type: "application/json" }));
      const anchor = document.createElement("a");
      anchor.href = url;
      anchor.download = diagnosticsFileName(stepId);
      anchor.click();
      // Revoked on a later task, once the browser has started reading the file.
      setTimeout(() => URL.revokeObjectURL(url), 0);
    }),
    /** Opens the preview; sending happens only from it, and sends the bundle it shows. */
    review: whenRead((text, bundle) => setPreview({ text, bundle })),
    preview: preview?.text ?? null,
    closePreview: () => setPreview(null),
    confirmSend: () => {
      if (preview) send.mutate({ bundle: preview.bundle });
    },
    sending: send.isPending,
  };
}
