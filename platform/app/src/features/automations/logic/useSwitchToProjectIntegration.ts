import { useState } from "react";
import { api } from "~/utils/api";
import { confirmSwitchToProjectIntegration } from "./slackLegacyTokenCopy";

/**
 * State and callbacks behind "switch this automation to the project's Slack
 * integration": the confirmed mutation, the cache invalidations that make the
 * nudge disappear once it succeeds, and the confirmation copy. The component
 * renders; this hook decides — it returns no JSX.
 */
export function useSwitchToProjectIntegration({
  projectId,
  automationId,
  automationName,
  workspaceName,
}: {
  projectId: string;
  automationId: string;
  automationName: string;
  workspaceName: string | null;
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
    confirmSwitch: () =>
      switchOver.mutate({ projectId, automationIds: [automationId] }),
  };
}
