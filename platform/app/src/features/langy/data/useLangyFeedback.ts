import { useCallback } from "react";
import { useOrganizationTeamProject } from "~/hooks/useOrganizationTeamProject";
import { api } from "~/utils/api";

export interface LangyFeedbackInput {
  conversationId?: string;
  messageId?: string;
  /** Trace id of the turn, so the feedback can attach to the LangWatch trace. */
  traceId?: string;
  rating: "up" | "down";
  sentiment?: "frustrated" | "delighted" | "neutral";
  comment?: string;
  /** The user granted permission to inspect the full conversation for debugging. */
  shareConversationConsent?: boolean;
}

/**
 * Thin wrapper over the backend feedback capture (`langy.recordFeedback`).
 * Feedback goes through the backend (never client-side capture) to PostHog and,
 * seamed on `traceId`, back into LangWatch itself as a feedback event on the
 * conversation's trace — so we dogfood Langy in our own account.
 */
export function useLangyFeedback() {
  const { project } = useOrganizationTeamProject();
  const mutation = api.langy.recordFeedback.useMutation();

  const submit = useCallback(
    (input: LangyFeedbackInput) => {
      const projectId = project?.id;
      if (!projectId) return;
      mutation.mutate({ projectId, ...input });
    },
    [project?.id, mutation],
  );

  return { submit, isSubmitting: mutation.isLoading };
}
