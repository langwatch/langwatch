import type { Cluster, Redis } from "ioredis";

/**
 * The Redis pub/sub client the scheduler's best-effort cross-pod wake talks to
 * (ADR-044 §4). Named as its own repository module so the calendar loop
 * (`scheduler.service.ts`) never imports the client library directly; publish
 * and subscribe are the whole surface it needs, so no narrower abstraction
 * over the client is warranted here.
 */
export type SchedulerWakeRedis = Redis | Cluster;
