import type IORedis from "ioredis";
import type { Cluster } from "ioredis";
import {
  LATENCY_HOUR_BUCKET_MS,
  LATENCY_MINUTE_BUCKET_MS,
  latencyAllTimeKey,
  latencyHourBucketKey,
  latencyMinuteBucketKey,
} from "@langwatch/ops-contract";
import {
  OpsMetricsRepository,
  type OpsLatencyHistograms,
  type OpsQueueTotals,
} from "../ops-metrics.repository";

const REDIS_STATE_KEY = "ops:metrics:state";
const KNOWN_PIPELINES_KEY = "ops:known-pipelines";

/** How many minute and hour buckets each window merges. */
const MINUTE_BUCKETS = 60;
const HOUR_BUCKETS = 168;

/**
 * The most pipeline paths one read reports. Far above any real fleet's
 * fan-out, so it bounds a runaway rather than truncating a healthy answer.
 */
const KNOWN_PIPELINE_PATH_LIMIT = 9999;

type PipelineResults = Array<[Error | null, unknown]>;

function hashAt(results: PipelineResults, index: number): Record<string, string> {
  return (results[index]?.[1] as Record<string, string>) ?? {};
}

/** Private Redis owner for the ops dashboard's counters, histograms and state. */
export class RedisOpsMetricsRepository extends OpsMetricsRepository {
  static create(input: { redis: IORedis | Cluster }): RedisOpsMetricsRepository {
    return new RedisOpsMetricsRepository(input.redis);
  }

  private constructor(private readonly redis: IORedis | Cluster) {
    super();
  }

  async readLatencyHistograms({
    queueNames,
    nowMs,
  }: {
    queueNames: string[];
    nowMs: number;
  }): Promise<OpsLatencyHistograms> {
    const pipeline = this.redis.pipeline();
    for (const queueName of queueNames) {
      for (let i = 0; i < MINUTE_BUCKETS; i++) {
        pipeline.hgetall(latencyMinuteBucketKey(queueName, nowMs - i * LATENCY_MINUTE_BUCKET_MS));
      }

      for (let i = 0; i < HOUR_BUCKETS; i++) {
        pipeline.hgetall(latencyHourBucketKey(queueName, nowMs - i * LATENCY_HOUR_BUCKET_MS));
      }

      pipeline.hgetall(latencyAllTimeKey(queueName));
    }

    const results = ((await pipeline.exec()) ?? []) as PipelineResults;
    const minute: Array<Record<string, string>> = [];
    const hourByQueue: Array<Array<Record<string, string>>> = [];
    const allTime: Array<Record<string, string>> = [];
    const perQueue = MINUTE_BUCKETS + HOUR_BUCKETS + 1;
    for (let q = 0; q < queueNames.length; q++) {
      const base = q * perQueue;
      for (let i = 0; i < MINUTE_BUCKETS; i++) {
        minute.push(hashAt(results, base + i));
      }

      const hours: Array<Record<string, string>> = [];
      for (let i = 0; i < HOUR_BUCKETS; i++) {
        hours.push(hashAt(results, base + MINUTE_BUCKETS + i));
      }

      hourByQueue.push(hours);
      allTime.push(hashAt(results, base + MINUTE_BUCKETS + HOUR_BUCKETS));
    }

    return { minute, hourByQueue, allTime };
  }

  async readQueueTotals({ queueNames }: { queueNames: string[] }): Promise<OpsQueueTotals[]> {
    const pipeline = this.redis.pipeline();
    for (const name of queueNames) {
      pipeline.get(`${name}:gq:stats:completed`);
      pipeline.get(`${name}:gq:stats:failed`);
    }

    const results = (await pipeline.exec()) as PipelineResults | null;

    return queueNames.map((_name, index) => ({
      completed: Number(results?.[index * 2]?.[1] ?? 0),
      failed: Number(results?.[index * 2 + 1]?.[1] ?? 0),
    }));
  }

  async readLatencySamplesMs({ queueNames }: { queueNames: string[] }): Promise<number[]> {
    const pipeline = this.redis.pipeline();
    for (const name of queueNames) {
      pipeline.lrange(`${name}:gq:stats:latencies-ms`, 0, -1);
    }

    const results = (await pipeline.exec()) as PipelineResults | null;
    const samples: number[] = [];
    for (const [, result] of results ?? []) {
      if (!Array.isArray(result)) {
        continue;
      }

      for (const raw of result) {
        const ms = Number(raw);
        if (Number.isFinite(ms) && ms >= 0) {
          samples.push(ms);
        }
      }
    }

    return samples;
  }

  async readJobNameTotals({
    queueNames,
    jobNames,
  }: {
    queueNames: string[];
    jobNames: string[];
  }): Promise<Map<string, OpsQueueTotals>> {
    const totals = new Map<string, OpsQueueTotals>();
    if (jobNames.length === 0) {
      return totals;
    }

    const pipeline = this.redis.pipeline();
    for (const jobName of jobNames) {
      for (const queueName of queueNames) {
        pipeline.get(`${queueName}:gq:stats:completed:${jobName}`);
        pipeline.get(`${queueName}:gq:stats:failed:${jobName}`);
      }
    }

    const results = (await pipeline.exec()) as PipelineResults | null;
    for (let i = 0; i < jobNames.length; i++) {
      let completed = 0;
      let failed = 0;
      for (let q = 0; q < queueNames.length; q++) {
        const base = (i * queueNames.length + q) * 2;
        completed += Number(results?.[base]?.[1] ?? 0);
        failed += Number(results?.[base + 1]?.[1] ?? 0);
      }

      totals.set(jobNames[i]!, { completed, failed });
    }

    return totals;
  }

  async readPausedJobKeys({ queueNames }: { queueNames: string[] }): Promise<string[]> {
    const pipeline = this.redis.pipeline();
    for (const name of queueNames) {
      pipeline.smembers(`${name}:gq:paused-jobs`);
    }

    const results = (await pipeline.exec()) as PipelineResults | null;
    const keys = new Set<string>();
    for (const [, result] of results ?? []) {
      if (Array.isArray(result)) {
        for (const key of result) {
          keys.add(key as string);
        }
      }
    }

    return Array.from(keys);
  }

  readPersistedState(): Promise<string | null> {
    return this.redis.get(REDIS_STATE_KEY);
  }

  async writePersistedState({
    state,
    ttlSeconds,
  }: {
    state: string;
    ttlSeconds: number;
  }): Promise<void> {
    await this.redis.set(REDIS_STATE_KEY, state, "EX", ttlSeconds);
  }

  readServerInfo(): Promise<string> {
    return this.redis.info();
  }

  async recordKnownPipelinePaths({
    paths,
    at,
    dropBefore,
  }: {
    paths: string[];
    at: number;
    dropBefore: number;
  }): Promise<void> {
    if (paths.length === 0) {
      return;
    }

    const pipeline = this.redis.pipeline();
    for (const path of paths) {
      pipeline.zadd(KNOWN_PIPELINES_KEY, at, path);
    }

    pipeline.zremrangebyscore(KNOWN_PIPELINES_KEY, 0, dropBefore);
    await pipeline.exec();
  }

  readKnownPipelinePaths(): Promise<string[]> {
    return this.redis.zrange(KNOWN_PIPELINES_KEY, 0, KNOWN_PIPELINE_PATH_LIMIT);
  }
}
