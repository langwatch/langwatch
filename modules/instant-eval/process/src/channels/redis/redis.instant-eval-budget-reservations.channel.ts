/**
 * Budget holds where every pod can see them: one key per hold with a lifetime,
 * under an index set, in one hash slot per organization. The lifetime bounds a
 * hold whose owner died without releasing it.
 */

import type {
  InstantEvalBudgetReservationOutcome,
  InstantEvalBudgetReservationsChannel,
} from "../instant-eval-budget-reservations.channel.ts";

/** The Redis surface this channel uses, structurally. */
export type InstantEvalBudgetReservationsRedis = {
  eval(script: string, keyCount: number, ...args: string[]): Promise<unknown>;
  del(key: string): Promise<unknown>;
  srem(key: string, member: string): Promise<unknown>;
};

/** The braces are a Redis Cluster hash tag: every key of one organization shares a slot. */
const KEY_PREFIX = "langwatch:{instant-evals:free-budget";

function indexKey(organizationId: string): string {
  return `${KEY_PREFIX}:${organizationId}}:reservations`;
}

function reservationKeyPrefix(organizationId: string): string {
  return `${KEY_PREFIX}:${organizationId}}:reservation:`;
}

/**
 * Sums the live reservations under the index, dropping members whose key has
 * lapsed, and holds the new amount when it fits. Answers `{1, total}` when
 * held and `{0, held}` when refused, where `held` is what the others hold.
 */
const RESERVE_SCRIPT = `
local index = KEYS[1]
local prefix = ARGV[1]
local id = ARGV[2]
local amount = tonumber(ARGV[3])
local limit = tonumber(ARGV[4])
local ttl = tonumber(ARGV[5])
local held = 0
for _, member in ipairs(redis.call('SMEMBERS', index)) do
  if member ~= id then
    local value = redis.call('GET', prefix .. member)
    if value then
      held = held + tonumber(value)
    else
      redis.call('SREM', index, member)
    end
  end
end
if held + amount > limit then
  return {0, tostring(held)}
end
redis.call('SET', prefix .. id, tostring(amount), 'EX', ttl)
redis.call('SADD', index, id)
redis.call('EXPIRE', index, ttl)
return {1, tostring(held + amount)}
`;

/** Sums the live reservations, leaving out ARGV[2] when it is not empty. */
const HELD_SCRIPT = `
local index = KEYS[1]
local prefix = ARGV[1]
local except = ARGV[2]
local held = 0
for _, member in ipairs(redis.call('SMEMBERS', index)) do
  if member ~= except then
    local value = redis.call('GET', prefix .. member)
    if value then
      held = held + tonumber(value)
    else
      redis.call('SREM', index, member)
    end
  end
end
return tostring(held)
`;

export class RedisInstantEvalBudgetReservationsChannel implements InstantEvalBudgetReservationsChannel {
  private constructor(private readonly redis: InstantEvalBudgetReservationsRedis) {}

  static create(input: {
    redis: InstantEvalBudgetReservationsRedis;
  }): RedisInstantEvalBudgetReservationsChannel {
    return new RedisInstantEvalBudgetReservationsChannel(input.redis);
  }

  async reserve({
    organizationId,
    reservationId,
    nanoUsd,
    limitNanoUsd,
    ttlMs,
  }: {
    organizationId: string;
    reservationId: string;
    nanoUsd: number;
    limitNanoUsd: number;
    ttlMs: number;
  }): Promise<InstantEvalBudgetReservationOutcome> {
    const reply = await this.redis.eval(
      RESERVE_SCRIPT,
      1,
      indexKey(organizationId),
      reservationKeyPrefix(organizationId),
      reservationId,
      String(Math.max(0, Math.round(nanoUsd))),
      String(Math.max(0, Math.round(limitNanoUsd))),
      String(Math.max(1, Math.ceil(ttlMs / 1000))),
    );
    const [held, amount] = readReply(reply);

    return { isReserved: held === 1, heldNanoUsd: amount };
  }

  async release({
    organizationId,
    reservationId,
  }: {
    organizationId: string;
    reservationId: string;
  }): Promise<void> {
    await this.redis.del(reservationKeyPrefix(organizationId) + reservationId);
    await this.redis.srem(indexKey(organizationId), reservationId);
  }

  async heldNanoUsd({
    organizationId,
    except,
  }: {
    organizationId: string;
    except?: string;
  }): Promise<number> {
    const reply = await this.redis.eval(
      HELD_SCRIPT,
      1,
      indexKey(organizationId),
      reservationKeyPrefix(organizationId),
      except ?? "",
    );

    return Number(reply);
  }
}

/** The script's two numbers, or a refusal holding nothing when it is not that shape. */
function readReply(reply: unknown): [number, number] {
  if (!Array.isArray(reply) || reply.length < 2) return [0, 0];

  return [Number(reply[0]), Number(reply[1])];
}
