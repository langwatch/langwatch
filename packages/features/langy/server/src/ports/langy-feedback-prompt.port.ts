/**
 * Private port and policy for Langy's Redis-backed feedback cadence.
 *
 * The portable contract exposes the two operations on LangyService; Redis and
 * the cadence record do not become part of the feature boundary.
 */

export interface LangyFeedbackPromptRedis {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: "EX", ttl: number): Promise<unknown>;
}

export const FEEDBACK_MIN_ANSWERS = 2;
export const FEEDBACK_QUIET_PERIOD_MS = 3 * 24 * 60 * 60 * 1000;
export const FEEDBACK_LONG_CONVERSATION_ANSWERS = 8;
const RECORD_TTL_SECONDS = 30 * 24 * 60 * 60;

interface LastAskRecord {
  atMs: number;
  conversationId: string;
}

const keyFor = (userId: string) => `langy:feedback:last-asked:${userId}`;

export class LangyFeedbackPromptPolicy {
  private constructor(
    private readonly deps: {
      redis: LangyFeedbackPromptRedis | null;
      now?: () => number;
    },
  ) {}

  static create(options: {
    redis: LangyFeedbackPromptRedis | null;
    now?: () => number;
  }): LangyFeedbackPromptPolicy {
    return new LangyFeedbackPromptPolicy(options);
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  async shouldAsk(input: {
    userId: string;
    conversationId: string;
    assistantAnswerCount: number;
  }): Promise<boolean> {
    if (input.assistantAnswerCount < FEEDBACK_MIN_ANSWERS) return false;
    if (!this.deps.redis) return false;

    let record: LastAskRecord | null;
    try {
      record = parseRecord(await this.deps.redis.get(keyFor(input.userId)));
    } catch {
      return false;
    }
    if (!record) return true;
    if (this.now() - record.atMs >= FEEDBACK_QUIET_PERIOD_MS) return true;
    return (
      input.assistantAnswerCount >= FEEDBACK_LONG_CONVERSATION_ANSWERS &&
      record.conversationId !== input.conversationId
    );
  }

  async markShown(input: {
    userId: string;
    conversationId: string;
  }): Promise<void> {
    if (!this.deps.redis) return;
    try {
      await this.deps.redis.set(
        keyFor(input.userId),
        JSON.stringify({ atMs: this.now(), conversationId: input.conversationId }),
        "EX",
        RECORD_TTL_SECONDS,
      );
    } catch {
      // A cadence write is best-effort. The worst case is one extra ask.
    }
  }
}

function parseRecord(raw: string | null): LastAskRecord | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<LastAskRecord>;
    if (typeof parsed.atMs !== "number" || !Number.isFinite(parsed.atMs)) {
      return null;
    }
    return {
      atMs: parsed.atMs,
      conversationId:
        typeof parsed.conversationId === "string" ? parsed.conversationId : "",
    };
  } catch {
    return null;
  }
}
