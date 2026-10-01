import type { OnboardingHostApi } from "../../../model/onboarding-host.ts";
import { type GuidedKickoff, planGuidedKickoffSend } from "../model/kickoff.ts";

/**
 * Queues the kickoff once Langy announces it is scoped to `organizationId`: the parts the
 * panel sends, and the attach the panel triggers once the send names its conversation.
 * Returns the release, for a kickoff still pending when the host unmounts.
 */
export function queueKickoffOnceScoped({
  host,
  organizationId,
  kickoff,
  attachConversation,
}: {
  host: OnboardingHostApi;
  organizationId: string;
  kickoff: GuidedKickoff;
  attachConversation: (input: { organizationId: string; conversationId: string }) => void;
}): () => void {
  return host.langy().onScopeAnnounced(organizationId, () => {
    const plan = planGuidedKickoffSend({ kickoff, organizationId });
    const attachTo = plan.attachToOrganizationId;
    host.langy().queueKickoff({
      brief: plan.brief,
      parts: plan.parts,
      conversationId: kickoff.conversationId ?? null,
      onConversationNamed: attachTo
        ? (conversationId) => attachConversation({ organizationId: attachTo, conversationId })
        : undefined,
    });
  });
}
