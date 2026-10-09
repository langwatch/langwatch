/**
 * The guided onboarding kickoff, settled from the durable guided state when
 * its turn starts.
 *
 * The panel builds the kickoff from the guided state it holds, and that
 * snapshot can be older than the tour's last write: the drawer records the
 * key the tour minted seconds before the tour ends and the kickoff is
 * queued. The lines of the brief that come from the state are rebuilt here,
 * from the state as stored, so the model reads what the organization
 * recorded and never what a browser happened to have cached.
 *
 * @see specs/langy/langy-guided-onboarding.feature
 */
import type { LangyMessagePart } from "@langwatch/langy";
import {
  type GuidedKickoffStateFacts,
  guidedKickoffPartOf,
  settleGuidedKickoffParts,
} from "~/features/guided-onboarding/kickoff";

/** Reads the facts the guided state settles, for the organization the turn runs in. */
export type GuidedKickoffFactsPort = (args: {
  organizationId: string;
}) => Promise<GuidedKickoffStateFacts>;

/**
 * The user message with its kickoff parts settled, or the message as sent
 * when it carries no kickoff or nothing reads the state.
 */
export async function settleGuidedKickoffMessage<
  M extends { parts: LangyMessagePart[] },
>({
  message,
  organizationId,
  facts,
}: {
  message: M | undefined;
  organizationId: string;
  facts: GuidedKickoffFactsPort | undefined;
}): Promise<M | undefined> {
  if (!message || !facts || !guidedKickoffPartOf(message.parts)) {
    return message;
  }
  const parts = settleGuidedKickoffParts({
    parts: message.parts,
    facts: await facts({ organizationId }),
  });
  return parts ? { ...message, parts: parts as LangyMessagePart[] } : message;
}
