/**
 * Langy Stream B — the raw token fast-path (ADR-048).
 *
 * A per-turn Redis **pub/sub** channel carrying opencode `text-delta` tokens
 * straight from the worker (`runTurn`) to an attached browser, with minimal
 * parsing and optimised purely for time-to-first-token.
 *
 * Deliberately pub/sub, NOT the durable XADD token buffer (ADR-044): a message
 * published with no subscriber is dropped, there is no TTL key to clean, and a
 * disconnect simply ends it. That IS the ephemeral contract — Stream B is
 * best-effort and never replays. The durable buffer (Stream A) remains the
 * source of truth and the resume state.
 *
 * Channel key is hash-tagged on conversationId (ADR-006) so it colocates with
 * the token stream + heartbeat keys on one cluster slot.
 *
 * Wire frames on the channel are compact JSON:
 *   {"d":"<token text>"}   a raw token delta
 *   {"e":1}                the turn ended (terminal)
 */

import { z } from "zod";

/** Redis surface the publisher uses (worker side). Satisfied by ioredis. */
export interface LangyFastStreamPublisherRedis {
  publish(channel: string, message: string): Promise<number>;
}

/**
 * Redis surface the subscriber uses (web side). `duplicate()` yields a
 * dedicated connection because a subscribed ioredis client cannot also run
 * normal commands. Satisfied by ioredis.
 */
export interface LangyFastStreamSubscriberRedis {
  duplicate(): LangyFastStreamSubscriberConnection;
}

export interface LangyFastStreamSubscriberConnection {
  subscribe(channel: string): Promise<unknown>;
  on(
    event: "message",
    listener: (channel: string, message: string) => void,
  ): unknown;
  unsubscribe(channel?: string): Promise<unknown>;
  disconnect(): void;
}

/**
 * The `type` discriminator the manager stamps on a Stream B fast frame on the
 * `/chat` ndjson stream (matches `langyTokenType` in the Go manager's
 * opencode.go). `runTurn` routes frames of this type to the fast channel and
 * the durable path ignores them.
 */
export const LANGY_FAST_TOKEN_TYPE = "langy.token";

export const LANGY_FAST_STREAM = {
  /**
   * Per-turn fast-token pub/sub channel. Hash-tagged on conversationId so it
   * colocates with the durable stream + heartbeat keys (ADR-006).
   */
  channel: (conversationId: string, turnId: string): string =>
    `langy:fast:{${conversationId}}:${turnId}`,
} as const;

/**
 * Slim Zod for the two fast-frame shapes. Deliberately minimal — this validates
 * a hot per-token path, so it only pins the discriminating field and stops.
 * Zod-only (infer the type) per the repo's validation convention.
 */
export const fastFrameSchema = z.union([
  z.object({ d: z.string() }),
  z.object({ e: z.literal(1) }),
]);
export type FastFrame = z.infer<typeof fastFrameSchema>;

function encodeToken(text: string): string {
  return JSON.stringify({ d: text } satisfies FastFrame);
}

function encodeEnd(): string {
  return JSON.stringify({ e: 1 } satisfies FastFrame);
}

/** Decode a wire frame into a token/end signal, or null if unparseable. */
export function decodeFastFrame(
  message: string,
): { token: string } | { end: true } | null {
  let raw: unknown;
  try {
    raw = JSON.parse(message);
  } catch {
    return null;
  }
  const parsed = fastFrameSchema.safeParse(raw);
  if (!parsed.success) return null;
  return "d" in parsed.data
    ? { token: parsed.data.d }
    : { end: true };
}

/**
 * Publisher used by the worker's `runTurn`. Fire-and-forget: a failed publish
 * degrades Stream B to "durable only" and must never fail the turn — callers
 * swallow the rejection.
 */
export class LangyFastTokenPublisher {
  constructor(private readonly redis: LangyFastStreamPublisherRedis) {}

  async publishToken({
    conversationId,
    turnId,
    text,
  }: {
    conversationId: string;
    turnId: string;
    text: string;
  }): Promise<void> {
    if (!text) return;
    await this.redis.publish(
      LANGY_FAST_STREAM.channel(conversationId, turnId),
      encodeToken(text),
    );
  }

  async publishEnd({
    conversationId,
    turnId,
  }: {
    conversationId: string;
    turnId: string;
  }): Promise<void> {
    await this.redis.publish(
      LANGY_FAST_STREAM.channel(conversationId, turnId),
      encodeEnd(),
    );
  }
}

/**
 * Subscribe an attached browser (SSE route) to a turn's fast token channel.
 * Push-based (pub/sub), on a dedicated duplicated connection. Returns a `close`
 * that unsubscribes and tears the connection down — the route calls it on the
 * end frame, on client disconnect, and on timeout.
 */
export function subscribeFastTokens({
  redis,
  conversationId,
  turnId,
  onToken,
  onEnd,
}: {
  redis: LangyFastStreamSubscriberRedis;
  conversationId: string;
  turnId: string;
  onToken: (text: string) => void;
  onEnd: () => void;
}): { close: () => void } {
  const channel = LANGY_FAST_STREAM.channel(conversationId, turnId);
  const sub = redis.duplicate();
  let closed = false;

  const close = () => {
    if (closed) return;
    closed = true;
    // Best-effort teardown — the connection is dedicated to this subscription.
    void Promise.resolve(sub.unsubscribe(channel)).catch(() => undefined);
    try {
      sub.disconnect();
    } catch {
      // already gone
    }
  };

  sub.on("message", (msgChannel, message) => {
    if (closed || msgChannel !== channel) return;
    const frame = decodeFastFrame(message);
    if (!frame) return;
    if ("token" in frame) {
      onToken(frame.token);
      return;
    }
    // Terminal frame — deliver end then tear down.
    onEnd();
    close();
  });

  void Promise.resolve(sub.subscribe(channel)).catch(() => {
    // Subscribe failed — degrade to durable-only. End the (empty) stream so the
    // route doesn't hang; the browser falls back to Stream A.
    if (!closed) {
      onEnd();
      close();
    }
  });

  return { close };
}
