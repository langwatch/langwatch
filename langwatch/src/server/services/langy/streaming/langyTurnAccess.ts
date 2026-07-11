/**
 * Who is allowed to watch a turn's live streams — answered SYNCHRONOUSLY.
 *
 * ── THE BUG THIS EXISTS TO KILL ────────────────────────────────────────────
 *
 * Stream B (the raw-token fast path, ADR-048) gated on the conversation FOLD:
 *
 *     const conv = await conversations.getById({ id, projectId, userId });
 *     if (!conv) return 404;
 *
 * The fold is a ClickHouse projection off the event log, so it lands
 * ASYNCHRONOUSLY — seconds after the turn starts. The browser subscribes to
 * `/fast` the instant it reads the `x-langy-turn-id` response header, which is
 * long before that. So on the FIRST turn of any conversation the fold did not
 * exist yet, `getById` returned null, and the route answered 404.
 *
 * Langy is overwhelmingly first turns. Which means the fast path built to make
 * Langy feel fast HAS NEVER ONCE RUN, and every turn has silently paid Stream
 * A's durability latency. It 404'd for the entire life of the feature and
 * nothing caught it, because a 404 from a nonexistent conversation and a 404
 * from a not-yet-projected one are the same 404.
 *
 * ── THE FIX ────────────────────────────────────────────────────────────────
 *
 * The chat route already knows exactly who started this turn, at the moment it
 * starts it. So it writes that down, in Redis, synchronously, before the turn is
 * dispatched — and the stream routes read THAT. No projection to wait for.
 *
 * NOT the spawn handoff, which looks like it would do: `take()` DELETES it, and
 * the spawn reactor consumes it as soon as the turn dispatches. It can be gone
 * before the browser has even subscribed. This record is never consumed; it just
 * ages out with the stream window.
 *
 * ── IT DOES NOT WEAKEN THE GATE ────────────────────────────────────────────
 *
 * Langy conversations are scoped to org + project + user. This record answers
 * exactly one question — "did THIS user, in THIS project, start THIS turn?" —
 * and the caller still verifies both ids against the session. It is a FAST PATH
 * for the person who started the turn, not a replacement for the visibility
 * rule: a viewer of a SHARED conversation has no record here, and falls through
 * to `getById`, which enforces sharing exactly as before.
 */

/** Long enough to outlive the token buffer's replay window; short enough to be transient. */
export const LANGY_TURN_ACCESS_TTL_SECONDS = 300;

export interface LangyTurnAccess {
  projectId: string;
  conversationId: string;
  turnId: string;
  /** The user who started the turn. */
  userId: string;
}

interface LangyAccessRedis {
  get(key: string): Promise<string | null>;
  set(
    key: string,
    value: string,
    mode: "EX",
    ttl: number,
  ): Promise<unknown>;
}

/**
 * Hash-tagged on the conversation so the key lands on the same Redis slot as the
 * turn's token buffer — one slot per conversation, as the rest of the streaming
 * layer already assumes.
 */
function accessKey(conversationId: string, turnId: string): string {
  return `langy:turn-access:{${conversationId}}:${turnId}`;
}

export class LangyTurnAccessStore {
  constructor(private readonly redis: LangyAccessRedis) {}

  /** Record who started this turn. Called in the POST, before the turn dispatches. */
  async grant(access: LangyTurnAccess): Promise<void> {
    await this.redis.set(
      accessKey(access.conversationId, access.turnId),
      JSON.stringify(access),
      "EX",
      LANGY_TURN_ACCESS_TTL_SECONDS,
    );
  }

  /**
   * Whether this user may watch this turn's live stream.
   *
   * `false` is NOT a denial — it means "no fast answer", and the caller must
   * fall back to the fold's visibility rule (which also covers shared
   * conversations and turns older than the window). Never grants access the fold
   * would refuse: it only ever confirms the turn's own actor.
   */
  async isTurnActor({
    projectId,
    conversationId,
    turnId,
    userId,
  }: LangyTurnAccess): Promise<boolean> {
    const raw = await this.redis.get(accessKey(conversationId, turnId));
    if (raw == null) return false;
    try {
      const access = JSON.parse(raw) as LangyTurnAccess;
      return access.projectId === projectId && access.userId === userId;
    } catch {
      return false;
    }
  }
}

export function createLangyTurnAccessStore(deps: {
  redis: unknown;
}): LangyTurnAccessStore {
  return new LangyTurnAccessStore(deps.redis as LangyAccessRedis);
}
