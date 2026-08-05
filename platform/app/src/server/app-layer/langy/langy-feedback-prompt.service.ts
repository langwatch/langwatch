/**
 * Backend-driven cadence for the "How did Langy do?" ask
 * (specs/langy/langy-feedback.feature, "Backend-driven cadence").
 *
 * The client never decides the moment on its own: `langy.messages` carries an
 * `shouldAskFeedback` flag computed here, and the panel reports the card being SHOWN
 * back through `markShown`. Showing counts as asking — an ignored card starts
 * the quiet period exactly like a rated one, which is what stops the card from
 * re-appearing under every answer. Keyed per user (not per project): nagging is
 * a property of the person's experience, not of any one project.
 *
 * The record lives in Redis rather than Postgres because it is a UX cadence,
 * not business data: losing it merely means one extra ask, and the TTL gives
 * it exactly the lifetime it needs.
 */

/** Minimal Redis surface. Injected so unit tests need no live server. */
export interface LangyFeedbackPromptRedis {
  get(key: string): Promise<string | null>;
  set(key: string, value: string, mode: "EX", ttl: number): Promise<unknown>;
}

/** Never under a conversation's first answer. */
export const FEEDBACK_MIN_ANSWERS = 2;
/** Quiet period once an ask has been shown, rated or not. */
export const FEEDBACK_QUIET_PERIOD_MS = 3 * 24 * 60 * 60 * 1000;
/**
 * A conversation that has grown well past a few answers may ask once more
 * despite the quiet period — but never twice in the same conversation.
 */
export const FEEDBACK_LONG_CONVERSATION_ANSWERS = 8;
/** How long the last-asked record survives. Losing it costs one extra ask. */
const RECORD_TTL_SECONDS = 30 * 24 * 60 * 60;

interface LastAskRecord {
  atMs: number;
  conversationId: string;
}

const keyFor = (userId: string) => `langy:feedback:last-asked:${userId}`;

export class LangyFeedbackPromptService {
  constructor(
    private readonly deps: {
      /** Null when the deployment runs without Redis: the ask is then never made. */
      redis: LangyFeedbackPromptRedis | null;
      /** Injectable clock for tests. */
      now?: () => number;
    },
  ) {}

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }

  /**
   * Should the panel ask for feedback under this conversation's latest answer?
   * Fail-closed: a Redis error means "don't ask" — a missed ask is free, an
   * accidental nag is not.
   */
  async shouldAsk({
    userId,
    conversationId,
    assistantAnswerCount,
  }: {
    userId: string;
    conversationId: string;
    assistantAnswerCount: number;
  }): Promise<boolean> {
    if (assistantAnswerCount < FEEDBACK_MIN_ANSWERS) return false;
    if (!this.deps.redis) return false;
    let record: LastAskRecord | null;
    try {
      record = parseRecord(await this.deps.redis.get(keyFor(userId)));
    } catch {
      return false;
    }
    if (!record) return true;
    if (this.now() - record.atMs >= FEEDBACK_QUIET_PERIOD_MS) return true;
    return (
      assistantAnswerCount >= FEEDBACK_LONG_CONVERSATION_ANSWERS &&
      record.conversationId !== conversationId
    );
  }

  /** The card was shown: start the quiet period. Best-effort. */
  async markShown({
    userId,
    conversationId,
  }: {
    userId: string;
    conversationId: string;
  }): Promise<void> {
    if (!this.deps.redis) return;
    const record: LastAskRecord = { atMs: this.now(), conversationId };
    try {
      await this.deps.redis.set(
        keyFor(userId),
        JSON.stringify(record),
        "EX",
        RECORD_TTL_SECONDS,
      );
    } catch {
      // Best-effort: the worst case is one extra ask later.
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
