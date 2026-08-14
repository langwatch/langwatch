import { useState } from "react";
import { api } from "~/utils/api";
import { confirmSwitchToProjectIntegration } from "./slackLegacyTokenCopy";

/**
 * State and callbacks behind "switch this automation to the project's Slack
 * integration": the confirmed mutation, the cache invalidations that make the
 * nudge disappear everywhere it renders (the automations list and the
 * composer's notice), and the confirmation copy. The ONE implementation —
 * the component renders; this hook decides, and returns no JSX.
 */
export function useSwitchToProjectIntegration({
  projectId,
  automationId,
  automationName,
  workspaceName,
  onSwitched,
}: {
  projectId: string;
  /** Absent while the surface has no saved row yet (a composer draft). */
  automationId?: string;
  /** Omitted where the surface has no name to hand — the composer edits a
   *  draft whose name lives on another step. */
  automationName?: string;
  workspaceName: string | null;
  /** Surface-specific follow-up after a successful switch. */
  onSwitched?: () => void;
}) {
  const [isConfirming, setIsConfirming] = useState(false);
  const utils = api.useUtils();
  const switchOver = api.slackIntegration.switchToIntegration.useMutation({
    onSuccess: () => {
      setIsConfirming(false);
      void utils.automation.getTriggers.invalidate({ projectId });
      void utils.slackIntegration.getLegacyTokenCensus.invalidate({
        projectId,
      });
      onSwitched?.();
    },
  });

  return {
    isConfirming,
    setIsConfirming,
    isPending: switchOver.isPending,
    isError: switchOver.isError,
    error: switchOver.error,
    confirmation: confirmSwitchToProjectIntegration({
      automationName,
      workspaceName,
    }),
    confirmSwitch: () => {
      if (!automationId) return;
      switchOver.mutate({ projectId, automationIds: [automationId] });
    },
  };
}
