import {
  type LangyFeedbackLastAsk,
  LangyFeedbackPromptRepository,
} from "../langy-feedback-prompt.repository.ts";

/** The cadence record in process memory. */
export class LangyFeedbackPromptMemoryRepository extends LangyFeedbackPromptRepository {
  private readonly lastAsks = new Map<string, LangyFeedbackLastAsk>();

  static create(): LangyFeedbackPromptMemoryRepository {
    return new LangyFeedbackPromptMemoryRepository();
  }

  private constructor() {
    super();
  }

  findLastAsked(userId: string): Promise<LangyFeedbackLastAsk[]> {
    const lastAsk = this.lastAsks.get(userId);
    return Promise.resolve(lastAsk ? [lastAsk] : []);
  }

  recordAsked({
    userId,
    lastAsk,
  }: {
    userId: string;
    lastAsk: LangyFeedbackLastAsk;
  }): Promise<void> {
    this.lastAsks.set(userId, lastAsk);
    return Promise.resolve();
  }
}
