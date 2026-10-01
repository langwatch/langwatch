import type { Redis } from "ioredis";

import {
  UI_ACTION_CLAIM_TTL_SECONDS,
  uiActionKeys,
  type PendingUiAction,
  type UiActionCompletion,
} from "./langy-ui-action.service.ts";

const RESULT_TTL_SECONDS = 30;
/** A page result bigger than this is a bug, not a payload. */
const MAX_RESULT_BYTES = 64 * 1024;

/** The Redis surface the page half needs (ioredis satisfies it). */
export type UiActionPageRedis = Pick<Redis, "set" | "get" | "del" | "lpush" | "expire">;

/**
 * The page half of the agent-to-page action channel: a tab claiming a published action and
 * reporting its outcome. Spec: specs/langy/langy-ui-actions.feature
 */
export class LangyUiActionPageService {
  static create(deps: { redis: UiActionPageRedis }): LangyUiActionPageService {
    return new LangyUiActionPageService(deps.redis);
  }

  private constructor(private readonly redis: UiActionPageRedis) {}

  /**
   * The page asking to execute `actionId`. First caller wins (SET NX); every other tab, every
   * stream replay, and a tab racing the dispatch's own handover to the backend gets `isClaimed:
   * false` and drops.
   */
  async claim({
    projectId,
    userId,
    conversationId,
    actionId,
  }: {
    projectId: string;
    userId: string;
    conversationId: string;
    actionId: string;
  }): Promise<{ isClaimed: boolean }> {
    const pending = await this.readPending(actionId);
    if (!pending || pending.projectId !== projectId || pending.conversationId !== conversationId) {
      return { isClaimed: false };
    }

    const set = await this.redis.set(
      uiActionKeys.claim(actionId),
      userId,
      "EX",
      UI_ACTION_CLAIM_TTL_SECONDS,
      "NX",
    );

    return { isClaimed: set === "OK" };
  }

  /**
   * The page reporting the claimed action's outcome.
   */
  async complete({
    projectId,
    userId,
    conversationId,
    actionId,
    completion,
  }: {
    projectId: string;
    userId: string;
    conversationId: string;
    actionId: string;
    completion: UiActionCompletion;
  }): Promise<{ isAccepted: boolean }> {
    const pending = await this.readPending(actionId);
    if (!pending || pending.projectId !== projectId || pending.conversationId !== conversationId) {
      return { isAccepted: false };
    }

    const claimant = await this.redis.get(uiActionKeys.claim(actionId));
    if (claimant !== userId) {
      return { isAccepted: false };
    }

    const raw = JSON.stringify(completion);
    // Measure what Redis stores: a string's length counts UTF-16 code units,
    // so a result of multi-byte characters passes a length check at up to
    // three times the ceiling.
    if (Buffer.byteLength(raw, "utf8") > MAX_RESULT_BYTES) {
      await this.redis.lpush(
        uiActionKeys.result(actionId),
        JSON.stringify({
          ok: false,
          errorCode: "result_too_large",
        } satisfies UiActionCompletion),
      );
    } else {
      await this.redis.lpush(uiActionKeys.result(actionId), raw);
    }

    await this.redis.expire(uiActionKeys.result(actionId), RESULT_TTL_SECONDS);
    await this.redis.del(uiActionKeys.pending(actionId));

    return { isAccepted: true };
  }

  private async readPending(actionId: string): Promise<PendingUiAction | null> {
    const raw = await this.redis.get(uiActionKeys.pending(actionId));
    if (!raw) {
      return null;
    }

    try {
      return JSON.parse(raw) as PendingUiAction;
    } catch {
      return null;
    }
  }
}
