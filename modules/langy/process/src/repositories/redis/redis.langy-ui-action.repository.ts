import type { Redis } from "ioredis";

import {
  type LangyUiActionPendingRead,
  LangyUiActionRepository,
  type LangyUiActionResultWait,
  type PendingUiAction,
} from "../langy-ui-action.repository.ts";

/** The Redis keys of one action, unchanged from the channel's first release. */
export const uiActionKeys = {
  pending: (actionId: string): string => `langy:ui:pending:${actionId}`,
  claim: (actionId: string): string => `langy:ui:claim:${actionId}`,
  result: (actionId: string): string => `langy:ui:result:${actionId}`,
};

/** The connection the blocking result wait duplicates for itself. */
export type UiActionBlockingRedis = Pick<Redis, "blpop" | "disconnect">;

/** The Redis surface the channel needs (ioredis satisfies it). */
export type UiActionRedis = Pick<Redis, "set" | "get" | "del" | "lpush" | "expire"> & {
  /** ioredis duplicate: a dedicated connection for the blocking wait. */
  duplicate(): UiActionBlockingRedis;
};

/** The channel's rows in the process's Redis: SET NX claims, BLPOP waits. */
export class RedisLangyUiActionRepository extends LangyUiActionRepository {
  static create(deps: { redis: UiActionRedis }): RedisLangyUiActionRepository {
    return new RedisLangyUiActionRepository(deps.redis);
  }

  private constructor(private readonly redis: UiActionRedis) {
    super();
  }

  async publishPending(input: {
    actionId: string;
    pending: PendingUiAction;
    ttlSeconds: number;
  }): Promise<void> {
    await this.redis.set(
      uiActionKeys.pending(input.actionId),
      JSON.stringify(input.pending),
      "EX",
      input.ttlSeconds,
    );
  }

  async readPending(actionId: string): Promise<LangyUiActionPendingRead> {
    const raw = await this.redis.get(uiActionKeys.pending(actionId));
    if (!raw) return { kind: "miss" };
    try {
      return { kind: "hit", pending: JSON.parse(raw) as PendingUiAction };
    } catch {
      return { kind: "miss" };
    }
  }

  async dropPending(actionId: string): Promise<void> {
    await this.redis.del(uiActionKeys.pending(actionId));
  }

  async claim(input: {
    actionId: string;
    claimant: string;
    ttlSeconds: number;
  }): Promise<{ isClaimed: boolean }> {
    const set = await this.redis.set(
      uiActionKeys.claim(input.actionId),
      input.claimant,
      "EX",
      input.ttlSeconds,
      "NX",
    );
    return { isClaimed: set === "OK" };
  }

  async isClaimedBy(input: { actionId: string; claimant: string }): Promise<boolean> {
    return (await this.redis.get(uiActionKeys.claim(input.actionId))) === input.claimant;
  }

  async pushResult(input: { actionId: string; raw: string; ttlSeconds: number }): Promise<void> {
    await this.redis.lpush(uiActionKeys.result(input.actionId), input.raw);
    await this.redis.expire(uiActionKeys.result(input.actionId), input.ttlSeconds);
  }

  openResultWait(): LangyUiActionResultWait {
    const blocking = this.redis.duplicate();
    return {
      next: async ({ actionId, timeoutSeconds }) => {
        const popped = await blocking.blpop(uiActionKeys.result(actionId), timeoutSeconds);
        return popped ? { kind: "result", raw: popped[1] } : { kind: "timeout" };
      },
      release: () => blocking.disconnect(),
    };
  }
}
