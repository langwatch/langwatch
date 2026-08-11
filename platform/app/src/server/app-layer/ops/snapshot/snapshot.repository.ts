import type { Cluster } from "ioredis";
import type IORedis from "ioredis";
import {
  type DetailSnapshot,
  detailSnapshotSchema,
  type LiveSnapshot,
  liveSnapshotSchema,
  parseSnapshot,
} from "./snapshot.types";

export const SNAPSHOT_LIVE_KEY = "ops:snapshot:live";
export const SNAPSHOT_DETAIL_KEY = "ops:snapshot:detail";
export const SNAPSHOT_LEASE_KEY = "ops:snapshot:lease";
export const SNAPSHOT_EPOCH_KEY = "ops:snapshot:epoch";

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

export interface LeaseState {
  /** True when this writer may scan and publish this cycle. */
  held: boolean;
  /**
   * Monotonic across acquisitions. Stamped into every artifact so a reader (or
   * a human) can tell "the writer changed" from "the writer is stuck".
   */
  epoch: number;
}

export interface SnapshotRepository {
  acquireOrRenewLease(params: { writerId: string }): Promise<LeaseState>;
  releaseLease(params: { writerId: string }): Promise<void>;
  writeLive(snapshot: LiveSnapshot): Promise<void>;
  writeDetail(snapshot: DetailSnapshot): Promise<void>;
  readLive(): Promise<LiveSnapshot | null>;
  readDetail(): Promise<DetailSnapshot | null>;
}

export class SnapshotRedisRepository implements SnapshotRepository {
  private currentEpoch = 0;

  constructor(private readonly redis: IORedis | Cluster) {}

  /**
   * One round trip in the common case (renewal), two on a fresh acquisition.
   *
   * A writer that renews keeps its epoch; a writer that acquires from cold
   * takes a new one. That means the epoch changes exactly when the writer
   * changes, which is the signal it exists to carry.
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
      return { held: true, epoch: this.currentEpoch };
    }

    const acquired = await this.redis.set(
      SNAPSHOT_LEASE_KEY,
      writerId,
      "EX",
      LEASE_TTL_SECONDS,
      "NX",
    );
    if (acquired !== "OK") return { held: false, epoch: this.currentEpoch };

    this.currentEpoch = Number(await this.redis.incr(SNAPSHOT_EPOCH_KEY)) || 0;
    return { held: true, epoch: this.currentEpoch };
  }

  async releaseLease({ writerId }: { writerId: string }): Promise<void> {
    await this.redis.eval(RELEASE_LUA, 1, SNAPSHOT_LEASE_KEY, writerId);
  }

  async writeLive(snapshot: LiveSnapshot): Promise<void> {
    await this.redis.set(
      SNAPSHOT_LIVE_KEY,
      JSON.stringify(snapshot),
      "EX",
      LIVE_TTL_SECONDS,
    );
  }

  async writeDetail(snapshot: DetailSnapshot): Promise<void> {
    await this.redis.set(
      SNAPSHOT_DETAIL_KEY,
      JSON.stringify(snapshot),
      "EX",
      DETAIL_TTL_SECONDS,
    );
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
