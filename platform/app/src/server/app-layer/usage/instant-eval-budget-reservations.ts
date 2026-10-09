/**
 * Reservations against the free Instant Evals budget.
 *
 * The ledger the budget is read from learns about a run when the run
 * finishes, so an admission check that reads the ledger alone lets any number
 * of runs through while none of them has landed a row. A reservation is the
 * amount a run or a judged query expects to spend, held under its own id from
 * the moment it is accepted until its spend reaches the ledger, and the
 * admission check counts what is held beside what was spent.
 *
 * The Redis store keeps one key per reservation with a lifetime, under an
 * index set, all in one hash slot per organization so a cluster keeps them
 * together. The lifetime bounds a reservation whose owner died without
 * releasing it: the page check still bounds that run's own overshoot, and the
 * hold lapses on its own. The in-memory store is the same contract for tests
 * and for a process with no Redis, where it is one process's own view.
 *
 * @see ./instant-eval-free-budget.service.ts
 * @see ../../../../../specs/instant-evals/instant-eval-billing.feature
 */

import type { RedisConnection } from "@langwatch/redis-client";

/** What a reservation attempt answered. */
export interface InstantEvalBudgetReservationOutcome {
  /** Whether the amount fit under the limit beside the other reservations. */
  readonly isReserved: boolean;
  /** What the other reservations of the organization held, in nano-USD. */
  readonly heldNanoUsd: number;
}

export interface InstantEvalBudgetReservations {
  /**
   * Holds `nanoUsd` under `reservationId` when it fits: the other live
   * reservations of the organization plus this amount stay within the limit.
   * A reservation under an id already held is replaced, not added.
   */
  reserve(input: {
    organizationId: string;
    reservationId: string;
    nanoUsd: number;
    limitNanoUsd: number;
    ttlMs: number;
  }): Promise<InstantEvalBudgetReservationOutcome>;
  /** Drops the reservation. Releasing one that is not held is not an error. */
  release(input: {
    organizationId: string;
    reservationId: string;
  }): Promise<void>;
  /** What the organization's live reservations hold, in nano-USD. */
  heldNanoUsd(input: {
    organizationId: string;
    /** A reservation to leave out, which is how a run excludes its own. */
    except?: string;
  }): Promise<number>;
}

const KEY_PREFIX = "langwatch:{instant-evals:free-budget";

function indexKey(organizationId: string): string {
  return `${KEY_PREFIX}:${organizationId}}:reservations`;
}

function reservationKeyPrefix(organizationId: string): string {
  return `${KEY_PREFIX}:${organizationId}}:reservation:`;
}

/**
 * Sums the live reservations under the index, dropping members whose key has
 * lapsed, and holds the new amount when it fits.
 *
 * KEYS[1] is the index set; ARGV is the reservation key prefix, the id, the
 * amount, the limit and the lifetime in seconds. Answers `{1, total}` when
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

export class RedisInstantEvalBudgetReservations
  implements InstantEvalBudgetReservations
{
  constructor(private readonly redis: RedisConnection) {}

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
    const reply = (await this.redis.eval(
      RESERVE_SCRIPT,
      1,
      indexKey(organizationId),
      reservationKeyPrefix(organizationId),
      reservationId,
      String(Math.max(0, Math.round(nanoUsd))),
      String(Math.max(0, Math.round(limitNanoUsd))),
      String(Math.max(1, Math.ceil(ttlMs / 1000))),
    )) as [number | string, string];
    return {
      isReserved: Number(reply[0]) === 1,
      heldNanoUsd: Number(reply[1]),
    };
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

interface HeldReservation {
  readonly nanoUsd: number;
  readonly expiresAt: number;
}

/** One process's own reservations, for tests and for a process with no Redis. */
export class InMemoryInstantEvalBudgetReservations
  implements InstantEvalBudgetReservations
{
  private readonly held = new Map<string, Map<string, HeldReservation>>();

  constructor(private readonly now: () => number = Date.now) {}

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
    const live = this.live(organizationId);
    const others = sumExcept({ live, except: reservationId });
    if (others + nanoUsd > limitNanoUsd) {
      return { isReserved: false, heldNanoUsd: others };
    }
    live.set(reservationId, { nanoUsd, expiresAt: this.now() + ttlMs });
    return { isReserved: true, heldNanoUsd: others + nanoUsd };
  }

  async release({
    organizationId,
    reservationId,
  }: {
    organizationId: string;
    reservationId: string;
  }): Promise<void> {
    this.held.get(organizationId)?.delete(reservationId);
  }

  async heldNanoUsd({
    organizationId,
    except,
  }: {
    organizationId: string;
    except?: string;
  }): Promise<number> {
    return sumExcept({ live: this.live(organizationId), except });
  }

  /** The organization's reservations with the lapsed ones dropped. */
  private live(organizationId: string): Map<string, HeldReservation> {
    let reservations = this.held.get(organizationId);
    if (!reservations) {
      reservations = new Map();
      this.held.set(organizationId, reservations);
    }
    const now = this.now();
    for (const [id, reservation] of reservations) {
      if (reservation.expiresAt <= now) reservations.delete(id);
    }
    return reservations;
  }
}

function sumExcept({
  live,
  except,
}: {
  live: ReadonlyMap<string, HeldReservation>;
  except: string | undefined;
}): number {
  let total = 0;
  for (const [id, reservation] of live) {
    if (id !== except) total += reservation.nanoUsd;
  }
  return total;
}

let processLocal: InMemoryInstantEvalBudgetReservations | null = null;

/**
 * The Redis store when a connection is there, and otherwise one in-memory
 * store shared by the whole process, so the run service and the executor
 * count the same reservations whichever built its budget first.
 */
export function createInstantEvalBudgetReservations({
  redis,
}: {
  redis: RedisConnection | null | undefined;
}): InstantEvalBudgetReservations {
  if (redis) return new RedisInstantEvalBudgetReservations(redis);
  processLocal ??= new InMemoryInstantEvalBudgetReservations();
  return processLocal;
}
