/**
 * The active runs in Redis: one sorted set per project and one for the deployment, each member a
 * run scored by when it stops counting, so a run that crashed before completing drops out.
 */
import type { Cluster, Redis } from "ioredis";

import { ExperimentRunActivityRepository } from "../experiment-run-activity.repository.ts";

const KEY_PREFIX = "eval_v3_active_runs:";
const GLOBAL_KEY = `${KEY_PREFIX}global`;
/** A set nobody wrote for a day holds only expired runs; Redis drops it. */
const KEY_IDLE_TTL_SECONDS = 24 * 60 * 60;

const projectKeyOf = (projectId: string) => `${KEY_PREFIX}project:${projectId}`;
const memberOf = (input: { projectId: string; runId: string }) =>
  `${input.projectId}:${input.runId}`;

export class RedisExperimentRunActivityRepository extends ExperimentRunActivityRepository {
  static create(options: { redis: Redis | Cluster }): RedisExperimentRunActivityRepository {
    return new RedisExperimentRunActivityRepository(options.redis);
  }

  private constructor(private readonly redis: Redis | Cluster) {
    super();
  }

  async markActive(input: { projectId: string; runId: string; expiresAt: number }): Promise<void> {
    const member = memberOf(input);
    await Promise.all(
      [projectKeyOf(input.projectId), GLOBAL_KEY].map(async (key) => {
        await this.redis.zadd(key, input.expiresAt, member);
        await this.redis.expire(key, KEY_IDLE_TTL_SECONDS);
      }),
    );
  }

  async markInactive(input: { projectId: string; runId: string }): Promise<void> {
    const member = memberOf(input);
    await Promise.all([
      this.redis.zrem(projectKeyOf(input.projectId), member),
      this.redis.zrem(GLOBAL_KEY, member),
    ]);
  }

  async countActive(input: {
    projectId: string;
    now: number;
  }): Promise<{ project: number; global: number }> {
    const [project, global] = await Promise.all(
      [projectKeyOf(input.projectId), GLOBAL_KEY].map(async (key) => {
        await this.redis.zremrangebyscore(key, "-inf", input.now);
        return this.redis.zcard(key);
      }),
    );
    return { project: project ?? 0, global: global ?? 0 };
  }
}
