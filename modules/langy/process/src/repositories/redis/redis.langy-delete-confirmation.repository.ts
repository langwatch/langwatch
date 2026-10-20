import type { Redis } from "ioredis";

import {
  confirmCardKey,
  confirmClaimKey,
  confirmGrantKey,
  confirmKeyBindingKey,
  type ConfirmTarget,
} from "../../rules/langy-local-control-keys.rules.ts";
import {
  confirmKeyBindingSchema,
  LangyDeleteConfirmationRepository,
  type ConfirmKeyBinding,
} from "../langy-delete-confirmation.repository.ts";
import type { LocalRecordLookup } from "../langy-local-call.repository.ts";

/** The Redis surface the confirmation records need. */
export type LangyDeleteConfirmationRedis = Pick<Redis, "get" | "set" | "exists" | "eval">;

/**
 * Every key must still hold a click before any is spent: a bulk request missing one click spends
 * nothing, and two requests racing for the same click cannot both win it.
 */
const CONSUME_ALL_OR_NONE =
  "for i = 1, #KEYS do\n" +
  "  if redis.call('EXISTS', KEYS[i]) == 0 then return 0 end\n" +
  "end\n" +
  "for i = 1, #KEYS do redis.call('DEL', KEYS[i]) end\n" +
  "return 1";

/** The confirmation records in the process's Redis, under the local-control key family. */
export class LangyDeleteConfirmationRedisRepository extends LangyDeleteConfirmationRepository {
  private constructor(private readonly redis: LangyDeleteConfirmationRedis) {
    super();
  }

  static create({
    redis,
  }: {
    redis: LangyDeleteConfirmationRedis;
  }): LangyDeleteConfirmationRedisRepository {
    return new LangyDeleteConfirmationRedisRepository(redis);
  }

  async saveKeyBinding({
    apiKeyId,
    binding,
    ttlSeconds,
  }: {
    apiKeyId: string;
    binding: ConfirmKeyBinding;
    ttlSeconds: number;
  }): Promise<void> {
    await this.redis.set(confirmKeyBindingKey(apiKeyId), JSON.stringify(binding), "EX", ttlSeconds);
  }

  async lookupKeyBinding(apiKeyId: string): Promise<LocalRecordLookup<ConfirmKeyBinding>> {
    const raw = await this.redis.get(confirmKeyBindingKey(apiKeyId));
    if (raw === null) return { kind: "miss" };
    const parsed = confirmKeyBindingSchema.safeParse(safeJson(raw));
    return parsed.success
      ? { kind: "hit", value: parsed.data }
      : { kind: "unreadable", reasons: [parsed.error] };
  }

  async saveGrant({
    target,
    ttlSeconds,
  }: {
    target: ConfirmTarget;
    ttlSeconds: number;
  }): Promise<void> {
    await this.redis.set(confirmGrantKey(target), "1", "EX", ttlSeconds);
  }

  async hasGrant(target: ConfirmTarget): Promise<boolean> {
    return (await this.redis.exists(confirmGrantKey(target))) === 1;
  }

  async consumeGrants(targets: readonly ConfirmTarget[]): Promise<boolean> {
    if (targets.length === 0) return false;
    const keys = targets.map(confirmGrantKey);
    return (await this.redis.eval(CONSUME_ALL_OR_NONE, keys.length, ...keys)) === 1;
  }

  async savePendingCard({
    target,
    waitId,
    ttlSeconds,
  }: {
    target: ConfirmTarget;
    waitId: string;
    ttlSeconds: number;
  }): Promise<void> {
    await this.redis.set(confirmCardKey(target), waitId, "EX", ttlSeconds);
  }

  async lookupPendingCard(target: ConfirmTarget): Promise<LocalRecordLookup<string>> {
    const waitId = await this.redis.get(confirmCardKey(target));
    return waitId === null ? { kind: "miss" } : { kind: "hit", value: waitId };
  }

  async claimCard({
    waitId,
    ttlSeconds,
  }: {
    waitId: string;
    ttlSeconds: number;
  }): Promise<boolean> {
    return (await this.redis.set(confirmClaimKey(waitId), "1", "EX", ttlSeconds, "NX")) === "OK";
  }
}

function safeJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}
