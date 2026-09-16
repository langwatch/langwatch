import type { Cluster, Redis } from "ioredis";

/**
 * Redis pub/sub client for the scheduler's best-effort cross-pod wake
 * (ADR-044 §4), named as its own repository so `scheduler.service.ts` never
 * imports the client library directly.
 */
export type SchedulerWakeRedis = Redis | Cluster;
