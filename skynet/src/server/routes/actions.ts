import { Router } from "express";
import type IORedis from "ioredis";
import { UNBLOCK_LUA, DRAIN_GROUP_LUA } from "../services/luaScripts.ts";
import { retryJob } from "../services/bullmqService.ts";

function isValidGroupId(id: string): boolean {
  return id.length > 0 && id.length <= 512;
}

export function createActionsRouter(redis: IORedis, getGroupQueueNames: () => string[]): Router {
  const router = Router();

  router.post("/api/actions/unblock", async (req, res) => {
    const { queueName, groupId } = req.body as { queueName?: string; groupId?: string };
    if (!queueName || !groupId) {
      res.status(400).json({ error: "queueName and groupId are required" });
      return;
    }

    if (!isValidGroupId(groupId)) {
      res.status(400).json({ error: "Invalid groupId" });
      return;
    }

    if (!getGroupQueueNames().includes(queueName)) {
      res.status(404).json({ error: "Unknown queue name" });
      return;
    }

    const prefix = `${queueName}:gq:`;
    const result = await redis.eval(
      UNBLOCK_LUA, 5,
      `${prefix}blocked`,
      `${prefix}group:${groupId}:active`,
      `${prefix}group:${groupId}:jobs`,
      `${prefix}ready`,
      `${prefix}signal`,
      groupId,
    );

    res.json({ ok: true, wasBlocked: result === 1 });
  });

  router.post("/api/actions/unblock-all", async (req, res) => {
    const { queueName } = req.body as { queueName?: string };
    if (!queueName) {
      res.status(400).json({ error: "queueName is required" });
      return;
    }

    if (!getGroupQueueNames().includes(queueName)) {
      res.status(404).json({ error: "Unknown queue name" });
      return;
    }

    const prefix = `${queueName}:gq:`;
    const blockedMembers = await redis.smembers(`${prefix}blocked`);

    let unblockedCount = 0;
    for (const groupId of blockedMembers) {
      const result = await redis.eval(
        UNBLOCK_LUA, 5,
        `${prefix}blocked`,
        `${prefix}group:${groupId}:active`,
        `${prefix}group:${groupId}:jobs`,
        `${prefix}ready`,
        `${prefix}signal`,
        groupId,
      );
      if (result === 1) unblockedCount++;
    }

    res.json({ ok: true, unblockedCount });
  });

  router.post("/api/actions/drain-group", async (req, res) => {
    const { queueName, groupId } = req.body as { queueName?: string; groupId?: string };
    if (!queueName || !groupId) {
      res.status(400).json({ error: "queueName and groupId are required" });
      return;
    }

    if (!isValidGroupId(groupId)) {
      res.status(400).json({ error: "Invalid groupId" });
      return;
    }

    if (!getGroupQueueNames().includes(queueName)) {
      res.status(404).json({ error: "Unknown queue name" });
      return;
    }

    const prefix = `${queueName}:gq:`;
    const result = await redis.eval(
      DRAIN_GROUP_LUA, 6,
      `${prefix}group:${groupId}:jobs`,
      `${prefix}group:${groupId}:data`,
      `${prefix}group:${groupId}:active`,
      `${prefix}ready`,
      `${prefix}blocked`,
      `${prefix}signal`,
      groupId,
    );

    res.json({ ok: true, jobsRemoved: result });
  });

  router.post("/api/actions/retry-blocked", async (req, res) => {
    const { queueName, groupId, jobId } = req.body as { queueName?: string; groupId?: string; jobId?: string };
    if (!queueName || !groupId || !jobId) {
      res.status(400).json({ error: "queueName, groupId, and jobId are required" });
      return;
    }

    if (!isValidGroupId(groupId)) {
      res.status(400).json({ error: "Invalid groupId" });
      return;
    }

    if (!getGroupQueueNames().includes(queueName)) {
      res.status(404).json({ error: "Unknown queue name" });
      return;
    }

    // 1. Retry the failed BullMQ job
    const retried = await retryJob(redis, queueName, jobId);

    // 2. Unblock the group
    const prefix = `${queueName}:gq:`;
    const unblocked = await redis.eval(
      UNBLOCK_LUA, 5,
      `${prefix}blocked`,
      `${prefix}group:${groupId}:active`,
      `${prefix}group:${groupId}:jobs`,
      `${prefix}ready`,
      `${prefix}signal`,
      groupId,
    );

    res.json({ ok: true, retried, unblocked: unblocked === 1 });
  });

  return router;
}
