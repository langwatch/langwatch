/** When Langy last asked this person for feedback, and in which conversation. */
export type LangyFeedbackLastAsk = { atMs: number; conversationId: string };

/**
 * The feedback cadence record, one per person, kept for a month: what stops Langy asking again
 * during the quiet period after a card was shown.
 */
export abstract class LangyFeedbackPromptRepository {
  /** The last ask, or none — a record that cannot be read counts as none. */
  abstract findLastAsked(userId: string): Promise<LangyFeedbackLastAsk[]>;

  abstract recordAsked(input: { userId: string; lastAsk: LangyFeedbackLastAsk }): Promise<void>;
}
