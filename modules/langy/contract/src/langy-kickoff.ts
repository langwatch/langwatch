/**
 * What a guided onboarding hands Langy when its tour ends: a user message the
 * panel sends on the next idle render. Langy carries it without owning its
 * vocabulary. @see specs/langy/langy-guided-onboarding.feature
 */
export interface LangyKickoffBrief {
  /** The text the model reads; also the label the outbound log shows. */
  brief: string;
  /**
   * The message parts to send, opaque to Langy: the caller's typed parts beside
   * the brief. Absent, the panel sends the brief as one text part.
   */
  parts?: readonly unknown[];
  /**
   * The conversation the kickoff continues, when the caller already attached
   * one. Without it the panel starts fresh.
   */
  conversationId?: string | null;
  /** Called once with the id of the conversation the send created. */
  onConversationNamed?: (conversationId: string) => void;
}
