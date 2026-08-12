import type IORedis from "ioredis";
import type { Cluster } from "ioredis";
import {
  type DetailSnapshot,
  detailSnapshotSchema,
  type LiveSnapshot,
  liveSnapshotSchema,
  parseSnapshot,
} from "./snapshot.types";

/**
 * The `{snapshot}` hash tag is load-bearing, not decoration.
 *
 * The fenced write below reads the lease and writes the artifact in one Lua
 * call. On Redis Cluster a script may only touch keys in a single slot, so
 * without a common hash tag the fence would fail with CROSSSLOT on exactly the
 * deployments that need it most.
 */
export const SNAPSHOT_LIVE_KEY = "ops:{snapshot}:live";
export const SNAPSHOT_DETAIL_KEY = "ops:{snapshot}:detail";
export const SNAPSHOT_LEASE_KEY = "ops:{snapshot}:lease";
export const SNAPSHOT_EPOCH_KEY = "ops:{snapshot}:epoch";

/**
 * The lease outlives several write cycles on purpose. Too short and an
 * ordinary GC pause hands the lease to another pod and back, churning the
 * writer for no reason; too long and a crashed writer leaves the dashboard
 * stale for the remainder. Ten seconds is five live cycles — long enough to
 * ride out a pause, short enough that a crash costs a handful of beats.
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

/**
 * Publish only if we still own the lease AND we are not moving `computedAt`
 * backwards.
 *
 * A scan is not instantaneous, so a writer can lose the lease part-way through
 * one and finish holding a payload it is no longer entitled to publish. An
 * unconditional SET at that moment overwrites the new writer's fresher artifact
 * with a stale one, and every dashboard in the fleet reads the stale copy —
 * ADR-090's single-writer guarantee holds for scanning but not for the write
 * that follows it. The lease check closes that window.
 *
 * The `computedAt` check closes the smaller one behind it: a single writer runs
 * the live and detail cycles concurrently, so a slow scan can still land after
 * a faster later one. Both artifacts are snapshots of the same underlying
 * state, so the newest observation always wins.
 *
 * KEYS: artifact, lease. ARGV: payload, writerId, ttlSeconds, computedAt.
 */
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

export interface LeaseState {
  /** True when this writer may scan and publish this cycle. */
  isHeld: boolean;
  /**
   * Increments on every acquisition — including a re-acquisition by the pod
   * that just lost it — and is stamped into every artifact. It answers "has the
   * writer restarted since the payload I am looking at", which is what
   * separates a stuck writer from a churning one. It is NOT a fleet-wide
   * ordering of writers, and a pod that has never held the lease reports 0.
   */
  epoch: number;
}

export interface SnapshotRepository {
  acquireOrRenewLease(params: { writerId: string }): Promise<LeaseState>;
  releaseLease(params: { writerId: string }): Promise<void>;
  /** Resolves true when the artifact was published, false when fenced out. */
  writeLive(params: {
    snapshot: LiveSnapshot;
    writerId: string;
  }): Promise<boolean>;
  /** Resolves true when the artifact was published, false when fenced out. */
  writeDetail(params: {
    snapshot: DetailSnapshot;
    writerId: string;
  }): Promise<boolean>;
  readLive(): Promise<LiveSnapshot | null>;
  readDetail(): Promise<DetailSnapshot | null>;
}

export class SnapshotRedisRepository implements SnapshotRepository {
  private currentEpoch = 0;

  constructor(private readonly redis: IORedis | Cluster) {}

  /**
   * One round trip in the common case (renewal), two on a fresh acquisition.
   *
   * A writer that renews keeps its epoch; any acquisition takes a fresh one
   * from the shared counter.
   */
  async acquireOrRenewLease({
    writerId,
  }: {
    writerId: string;
  }): Promise<LeaseState> {
    const renewed = await this.redis.eval(
      RENEW_LUA,
      1,
      SNAPSHOT_LEASE_KEY,
      writerId,
      String(LEASE_TTL_SECONDS),
    );
    if (Number(renewed) === 1) {
      return { isHeld: true, epoch: this.currentEpoch };
    }

    const acquired = await this.redis.set(
      SNAPSHOT_LEASE_KEY,
      writerId,
      "EX",
      LEASE_TTL_SECONDS,
      "NX",
    );
    if (acquired !== "OK") return { isHeld: false, epoch: this.currentEpoch };

    this.currentEpoch = Number(await this.redis.incr(SNAPSHOT_EPOCH_KEY)) || 0;
    return { isHeld: true, epoch: this.currentEpoch };
  }

  async releaseLease({ writerId }: { writerId: string }): Promise<void> {
    await this.redis.eval(RELEASE_LUA, 1, SNAPSHOT_LEASE_KEY, writerId);
  }

  async writeLive({
    snapshot,
    writerId,
  }: {
    snapshot: LiveSnapshot;
    writerId: string;
  }): Promise<boolean> {
    return this.writeFenced({
      key: SNAPSHOT_LIVE_KEY,
      snapshot,
      writerId,
      ttlSeconds: LIVE_TTL_SECONDS,
    });
  }

  async writeDetail({
    snapshot,
    writerId,
  }: {
    snapshot: DetailSnapshot;
    writerId: string;
  }): Promise<boolean> {
    return this.writeFenced({
      key: SNAPSHOT_DETAIL_KEY,
      snapshot,
      writerId,
      ttlSeconds: DETAIL_TTL_SECONDS,
    });
  }

  private async writeFenced({
    key,
    snapshot,
    writerId,
    ttlSeconds,
  }: {
    key: string;
    snapshot: LiveSnapshot | DetailSnapshot;
    writerId: string;
    ttlSeconds: number;
  }): Promise<boolean> {
    const written = await this.redis.eval(
      WRITE_FENCED_LUA,
      2,
      key,
      SNAPSHOT_LEASE_KEY,
      JSON.stringify(snapshot),
      writerId,
      String(ttlSeconds),
      String(snapshot.computedAt),
    );
    return Number(written) === 1;
  }

  async readLive(): Promise<LiveSnapshot | null> {
    return parseSnapshot(
      liveSnapshotSchema,
      await this.redis.get(SNAPSHOT_LIVE_KEY),
    );
  }

  async readDetail(): Promise<DetailSnapshot | null> {
    return parseSnapshot(
      detailSnapshotSchema,
      await this.redis.get(SNAPSHOT_DETAIL_KEY),
    );
  }
}
