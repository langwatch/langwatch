import type IORedis from "ioredis";
import { DRAIN_GROUP_LUA, UNBLOCK_LUA } from "./luaScripts.ts";
import { retryJob } from "./bullmqService.ts";
import { isGroupQueue } from "./queueDiscovery.ts";

export class GroupQueueActionService {
  constructor(
    private readonly redis: IORedis,
    private readonly getGroupQueueNames: () => string[],
  ) {}

  isKnownQueue(queueName: string): boolean {
    return this.getGroupQueueNames().includes(queueName);
  }

  async unblockGroup({
    queueName,
    groupId,
  }: {
    queueName: string;
    groupId: string;
  }): Promise<{ wasBlocked: boolean }> {
    const prefix = `${queueName}:gq:`;
    const result = await this.redis.eval(
      UNBLOCK_LUA, 6,
      `${prefix}blocked`,
      `${prefix}group:${groupId}:active`,
      `${prefix}group:${groupId}:jobs`,
      `${prefix}ready`,
      `${prefix}signal`,
      `${prefix}group:${groupId}:error`,
      groupId,
    );

    return { wasBlocked: result === 1 };
  }

  async unblockAll({
    queueName,
  }: {
    queueName: string;
  }): Promise<{ unblockedCount: number }> {
    const prefix = `${queueName}:gq:`;
    const blockedMembers = await this.redis.smembers(`${prefix}blocked`);

    if (blockedMembers.length === 0) {
      return { unblockedCount: 0 };
    }

    const pipeline = this.redis.pipeline();
    for (const groupId of blockedMembers) {
      pipeline.eval(
        UNBLOCK_LUA, 6,
        `${prefix}blocked`,
        `${prefix}group:${groupId}:active`,
        `${prefix}group:${groupId}:jobs`,
        `${prefix}ready`,
        `${prefix}signal`,
        `${prefix}group:${groupId}:error`,
        groupId,
      );
    }
    const results = await pipeline.exec();

    let unblockedCount = 0;
    if (results) {
      for (const [err, result] of results) {
        if (!err && result === 1) unblockedCount++;
      }
    }

    return { unblockedCount };
  }

  async drainGroup({
    queueName,
    groupId,
  }: {
    queueName: string;
    groupId: string;
  }): Promise<{ jobsRemoved: number }> {
    const prefix = `${queueName}:gq:`;
    const result = await this.redis.eval(
      DRAIN_GROUP_LUA, 7,
      `${prefix}group:${groupId}:jobs`,
      `${prefix}group:${groupId}:data`,
      `${prefix}group:${groupId}:active`,
      `${prefix}ready`,
      `${prefix}blocked`,
      `${prefix}signal`,
      `${prefix}group:${groupId}:error`,
      groupId,
    );

    return { jobsRemoved: Number(result) };
  }

  async retryBlocked({
    queueName,
    groupId,
    jobId,
  }: {
    queueName: string;
    groupId: string;
    jobId: string;
  }): Promise<{ retried: boolean; unblocked: boolean }> {
    const retried = isGroupQueue(queueName)
      ? true
      : await retryJob(this.redis, queueName, jobId);

    const { wasBlocked } = await this.unblockGroup({ queueName, groupId });

    return { retried, unblocked: wasBlocked };
  }

  async pauseKey({
    queueName,
    pauseKey,
  }: {
    queueName: string;
    pauseKey: string;
  }): Promise<void> {
    await this.redis.sadd(`${queueName}:gq:paused-jobs`, pauseKey);
  }

  async unpauseKey({
    queueName,
    pauseKey,
  }: {
    queueName: string;
    pauseKey: string;
  }): Promise<void> {
    await this.redis.srem(`${queueName}:gq:paused-jobs`, pauseKey);
    await this.redis.lpush(`${queueName}:gq:signal`, "1");
  }

  async listPausedKeys({
    queueName,
  }: {
    queueName: string;
  }): Promise<string[]> {
    return this.redis.smembers(`${queueName}:gq:paused-jobs`);
  }
}
