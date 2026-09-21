/**
 * What a guided onboarding hands Langy when its tour ends: a user message the
 * panel sends on the next idle render. Langy carries it without owning its
 * vocabulary. @see specs/langy/langy-guided-onboarding.feature
 */
export interface LangyKickoffBrief {
  /** The text the model reads. */
  brief: string;
  /**
   * The conversation the kickoff continues, when the caller already attached
   * one. Without it the panel starts fresh and attaches what the transport
   * creates.
   */
  conversationId?: string | null;
}
