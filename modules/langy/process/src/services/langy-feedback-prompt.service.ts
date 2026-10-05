import { nowInstant } from "@langwatch/time";

import type { LangyFeedbackPromptRepository } from "../repositories/langy-feedback-prompt.repository.ts";

/**
 * Private policy for Langy's feedback cadence. The portable
 * contract exposes the two operations on LangyApi; Redis and the cadence
 * record do not become part of the feature boundary.
 */

export const FEEDBACK_MIN_ANSWERS = 2;
export const FEEDBACK_QUIET_PERIOD_MS = 3 * 24 * 60 * 60 * 1000;
export const FEEDBACK_LONG_CONVERSATION_ANSWERS = 8;

export class LangyFeedbackPromptService {
  private constructor(
    private readonly deps: {
      prompts: LangyFeedbackPromptRepository;
      now?: () => number;
    },
  ) {}

  static create(options: {
    prompts: LangyFeedbackPromptRepository;
    now?: () => number;
  }): LangyFeedbackPromptService {
    return new LangyFeedbackPromptService(options);
  }

  private now(): number {
    return this.deps.now?.() ?? nowInstant().epochMilliseconds;
  }

  async shouldAsk(input: {
    userId: string;
    conversationId: string;
    assistantAnswerCount: number;
  }): Promise<boolean> {
    if (input.assistantAnswerCount < FEEDBACK_MIN_ANSWERS) return false;
    let lastAsks;
    try {
      lastAsks = await this.deps.prompts.findLastAsked(input.userId);
    } catch {
      return false;
    }
    const [lastAsk] = lastAsks;
    if (!lastAsk) return true;
    if (this.now() - lastAsk.atMs >= FEEDBACK_QUIET_PERIOD_MS) return true;
    return (
      input.assistantAnswerCount >= FEEDBACK_LONG_CONVERSATION_ANSWERS &&
      lastAsk.conversationId !== input.conversationId
    );
  }

  async markShown(input: { userId: string; conversationId: string }): Promise<void> {
    try {
      await this.deps.prompts.recordAsked({
        userId: input.userId,
        lastAsk: { atMs: this.now(), conversationId: input.conversationId },
      });
    } catch {
      // A cadence write is best-effort. The worst case is one extra ask.
    }
  }
}
