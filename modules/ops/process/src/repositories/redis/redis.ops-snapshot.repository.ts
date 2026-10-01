import { generate } from "@langwatch/ksuid";
import {
  type DetailSnapshot,
  type LiveSnapshot,
  type OpsSnapshotLease,
  tryParseDetailSnapshot,
  tryParseLiveSnapshot,
} from "@langwatch/ops-contract";
import type { RedisConnection } from "@langwatch/redis-client";

import { type OpsSnapshotRead, OpsSnapshotRepository } from "../ops-snapshot.repository.ts";

/**
 * The `{snapshot}` hash tag is load-bearing: the fenced write below reads
 * the lease and writes the artifact in one Lua call, and on Redis Cluster a
 * script may only touch keys in a single slot.
 */
export const SNAPSHOT_LIVE_KEY = "ops:{snapshot}:live";
export const SNAPSHOT_DETAIL_KEY = "ops:{snapshot}:detail";
export const SNAPSHOT_LEASE_KEY = "ops:{snapshot}:lease";
export const SNAPSHOT_EPOCH_KEY = "ops:{snapshot}:epoch";

/**
 * The lease outlives several write cycles on purpose: too short and a GC
 * pause churns the writer between pods; too long and a crash leaves the
 * dashboard stale. Ten seconds is five live cycles.
 */
export const LEASE_TTL_SECONDS = 10;

/** Live artifact outlives several cycles so a brief writer gap is invisible. */
const LIVE_TTL_SECONDS = 60;
/** Detail outlives its own cadence generously; staleness is reported, not hidden. */
const DETAIL_TTL_SECONDS = 300;

/**
 * Renew only if we still hold it. A blind EXPIRE would let a writer that lost
 * the lease keep extending the NEW holder's key, which is the one way a lease
 * can be held by two pods at once indefinitely.
 */
const RENEW_LUA = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('EXPIRE', KEYS[1], ARGV[2])
end
return 0
`;

/** Compare-and-delete, so a lapsed writer cannot release its successor's lease. */
const RELEASE_LUA = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;

/** Guards lease and computedAt to prevent stale writes and backwards time movement. */
const WRITE_FENCED_LUA = `
if redis.call('GET', KEYS[2]) ~= ARGV[2] then
  return 0
end
local existing = redis.call('GET', KEYS[1])
if existing then
  local ok, decoded = pcall(cjson.decode, existing)
  if ok and type(decoded) == 'table' then
    local previous = tonumber(decoded.computedAt)
    if previous and previous > tonumber(ARGV[4]) then
      return 0
    end
  end
end
redis.call('SET', KEYS[1], ARGV[1], 'EX', ARGV[3])
return 1
`;

export class RedisOpsSnapshotRepository extends OpsSnapshotRepository {
  private currentEpoch = 0;
  /** The value this instance last wrote into the lease key, or null. */
  private currentToken: string | null = null;

  static create(redis: RedisConnection): RedisOpsSnapshotRepository {
    return new RedisOpsSnapshotRepository(redis);
  }

  private constructor(private readonly redis: RedisConnection) {
    super();
  }

  /**
   * One round trip in the common case (renewal), two on a fresh acquisition.
   * The token, not the writer id, is what lands in the lease key - see
   * `LeaseState.token` for why a stable per-pod value cannot fence a write.
   */
  async acquireOrRenewLease({ writerId }: { writerId: string }): Promise<OpsSnapshotLease> {
    if (this.currentToken) {
      const renewed = await this.redis.eval(
        RENEW_LUA,
        1,
        SNAPSHOT_LEASE_KEY,
        this.currentToken,
        String(LEASE_TTL_SECONDS),
      );
      if (Number(renewed) === 1) {
        return {
          isHeld: true,
          epoch: this.currentEpoch,
          token: this.currentToken,
        };
      }
      // Lost it. Drop the token before trying to acquire, so a failed
      // acquisition cannot leave us claiming to hold a lease we do not.
      this.currentToken = null;
    }

    const token = `${writerId}:${generate("opssnapshotlock").toString()}`;
    const acquired = await this.redis.set(SNAPSHOT_LEASE_KEY, token, "EX", LEASE_TTL_SECONDS, "NX");
    if (acquired !== "OK") {
      return { isHeld: false, epoch: this.currentEpoch, token: null };
    }

    this.currentToken = token;
    this.currentEpoch = Number(await this.redis.incr(SNAPSHOT_EPOCH_KEY)) || 0;
    return { isHeld: true, epoch: this.currentEpoch, token };
  }

  async releaseLease(): Promise<void> {
    if (!this.currentToken) return;
    await this.redis.eval(RELEASE_LUA, 1, SNAPSHOT_LEASE_KEY, this.currentToken);
    this.currentToken = null;
  }

  async writeLive({
    snapshot,
    leaseToken,
  }: {
    snapshot: LiveSnapshot;
    leaseToken: string;
  }): Promise<boolean> {
    return this.writeFenced({
      key: SNAPSHOT_LIVE_KEY,
      snapshot,
      leaseToken,
      ttlSeconds: LIVE_TTL_SECONDS,
    });
  }

  async writeDetail({
    snapshot,
    leaseToken,
  }: {
    snapshot: DetailSnapshot;
    leaseToken: string;
  }): Promise<boolean> {
    return this.writeFenced({
      key: SNAPSHOT_DETAIL_KEY,
      snapshot,
      leaseToken,
      ttlSeconds: DETAIL_TTL_SECONDS,
    });
  }

  private async writeFenced({
    key,
    snapshot,
    leaseToken,
    ttlSeconds,
  }: {
    key: string;
    snapshot: LiveSnapshot | DetailSnapshot;
    leaseToken: string;
    ttlSeconds: number;
  }): Promise<boolean> {
    const written = await this.redis.eval(
      WRITE_FENCED_LUA,
      2,
      key,
      SNAPSHOT_LEASE_KEY,
      JSON.stringify(snapshot),
      leaseToken,
      String(ttlSeconds),
      String(snapshot.computedAt),
    );
    return Number(written) === 1;
  }

  async readLive(): Promise<OpsSnapshotRead<LiveSnapshot>> {
    const snapshot = tryParseLiveSnapshot(await this.redis.get(SNAPSHOT_LIVE_KEY));
    return snapshot ? { kind: "hit", snapshot } : { kind: "miss" };
  }

  async readDetail(): Promise<OpsSnapshotRead<DetailSnapshot>> {
    const snapshot = tryParseDetailSnapshot(await this.redis.get(SNAPSHOT_DETAIL_KEY));
    return snapshot ? { kind: "hit", snapshot } : { kind: "miss" };
  }
}
