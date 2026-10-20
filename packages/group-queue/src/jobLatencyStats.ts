import { nowInstant } from "@langwatch/time";
import type { Cluster, Redis as IORedis } from "ioredis";

const LATENCY_SAMPLE_SIZE = 200;
const LATENCY_MINUTE_BUCKET_TTL_SECONDS = 2 * 60 * 60;
const LATENCY_HOUR_BUCKET_TTL_SECONDS = 8 * 24 * 60 * 60;

/** How long a completed job's latency waits in process before it reaches the ops figures. */
export const LATENCY_STATS_FLUSH_INTERVAL_MS = 1_000;

function latencyBucketField(durationMs: number): string {
  for (let power = 1; power <= 524_288; power *= 2) {
    if (durationMs <= power) return String(power);
    if (durationMs <= power * 1.5) return String(power * 1.5);
  }
  return "+Inf";
}

function latencyMinuteBucketKey(queueName: string, nowMs: number): string {
  return `${queueName}:gq:stats:lat-hist:m:${Math.floor(nowMs / 60_000)}`;
}

function latencyHourBucketKey(queueName: string, nowMs: number): string {
  return `${queueName}:gq:stats:lat-hist:h:${Math.floor(nowMs / 3_600_000)}`;
}

function latencyAllTimeKey(queueName: string): string {
  return `${queueName}:gq:stats:lat-hist:all`;
}

/** Only what the flush calls. */
type LatencyStatsRedis = Pick<IORedis | Cluster, "pipeline">;

type HistogramBucket = { ttlSeconds: number | null; counts: Map<string, number> };

/**
 * Feeds the ops dashboard latency figures (the P50/P99 sample list and the
 * time-bucketed histograms), counted in process and written as one pipeline per
 * interval rather than per job: at most one interval of lag; a failed write is dropped.
 */
export class JobLatencyStats {
  private samples: number[] = [];
  private histograms = new Map<string, HistogramBucket>();
  private flushTimer: ReturnType<typeof setTimeout> | undefined;

  constructor(
    private readonly params: {
      redis: LatencyStatsRedis;
      queueName: string;
      flushIntervalMs?: number;
      now?: () => number;
    },
  ) {}

  record(durationMs: number): void {
    const completedAtMs = this.params.now?.() ?? nowInstant().epochMilliseconds;
    const field = latencyBucketField(durationMs);
    const { queueName } = this.params;

    this.samples.push(Math.round(durationMs));
    if (this.samples.length > LATENCY_SAMPLE_SIZE) this.samples.shift();
    this.count({
      key: latencyMinuteBucketKey(queueName, completedAtMs),
      ttlSeconds: LATENCY_MINUTE_BUCKET_TTL_SECONDS,
      field,
    });
    this.count({
      key: latencyHourBucketKey(queueName, completedAtMs),
      ttlSeconds: LATENCY_HOUR_BUCKET_TTL_SECONDS,
      field,
    });
    this.count({ key: latencyAllTimeKey(queueName), ttlSeconds: null, field });

    if (!this.flushTimer) {
      this.flushTimer = setTimeout(() => {
        void this.flush();
      }, this.params.flushIntervalMs ?? LATENCY_STATS_FLUSH_INTERVAL_MS);
      this.flushTimer.unref?.();
    }
  }

  /** Writes everything recorded so far in one pipeline; resolves even when the write fails. */
  async flush(): Promise<void> {
    clearTimeout(this.flushTimer);
    this.flushTimer = undefined;
    const samples = this.samples;
    const histograms = this.histograms;
    if (samples.length === 0 && histograms.size === 0) return;
    this.samples = [];
    this.histograms = new Map();

    const samplesKey = `${this.params.queueName}:gq:stats:latencies-ms`;
    const pipeline = this.params.redis.pipeline();
    if (samples.length > 0) {
      // Oldest first, so the newest sample ends at the head as one LPUSH per job left it.
      pipeline.lpush(samplesKey, ...samples.map(String));
      pipeline.ltrim(samplesKey, 0, LATENCY_SAMPLE_SIZE - 1);
    }
    for (const [key, { ttlSeconds, counts }] of histograms) {
      for (const [field, increment] of counts) pipeline.hincrby(key, field, increment);
      if (ttlSeconds !== null) pipeline.expire(key, ttlSeconds);
    }
    try {
      await pipeline.exec();
    } catch {
      // best-effort stats write; failures are non-fatal
    }
  }

  private count({
    key,
    ttlSeconds,
    field,
  }: {
    key: string;
    ttlSeconds: number | null;
    field: string;
  }): void {
    const bucket = this.histograms.get(key) ?? { ttlSeconds, counts: new Map<string, number>() };
    bucket.counts.set(field, (bucket.counts.get(field) ?? 0) + 1);
    this.histograms.set(key, bucket);
  }
}
