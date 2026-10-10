import { useCallback, useState } from "react";

import { usePersonalWorkspaceHost } from "../../../model/personal-workspace-host.ts";

/**
 * A fresh set of backup codes, replacing whatever was left of the old one.
 * Spec: specs/identity/mfa-and-session-shape.feature
 */
export function useBackupCodesRegeneration({
  onGenerated,
}: {
  onGenerated: (codes: readonly string[]) => void;
}) {
  const host = usePersonalWorkspaceHost();
  const [isGenerating, setIsGenerating] = useState(false);

  const regenerate = useCallback(
    async (password?: string) => {
      setIsGenerating(true);
      const answer = await host.regenerateBackupCodes({ password });
      setIsGenerating(false);
      if (!answer.ok) {
        host.failed({ error: answer.error, fallbackTitle: "Those codes weren't generated" });
        return;
      }
      onGenerated(answer.value.backupCodes);
    },
    [host, onGenerated],
  );

  return { isGenerating, regenerate };
}
