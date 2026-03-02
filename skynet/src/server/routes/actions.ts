import { Router } from "express";
import type IORedis from "ioredis";
import { retryJob } from "../services/bullmqService.ts";
import { isGroupQueue } from "../services/queueDiscovery.ts";
import { DRAIN_GROUP_LUA, UNBLOCK_LUA } from "../services/luaScripts.ts";

function isValidGroupId(id: unknown): id is string {
	return typeof id === "string" && id.length > 0 && id.length <= 512;
}

export function createActionsRouter(redis: IORedis, getGroupQueueNames: () => string[]): Router {
  const router = Router();

  router.post("/api/actions/unblock", async (req, res) => {
    try {
      const { queueName, groupId } = req.body as { queueName?: string; groupId?: string };
      if (!queueName || !groupId) {
        res.status(400).json({ error: "queueName and groupId are required" });
        return;
      }

      if (!isValidGroupId(groupId)) {
        res.status(400).json({ error: "Invalid groupId format" });
        return;
      }

      if (!getGroupQueueNames().includes(queueName)) {
        res.status(404).json({ error: "Unknown queue name" });
        return;
      }

      const prefix = `${queueName}:gq:`;
      const result = await redis.eval(
        UNBLOCK_LUA, 6,
        `${prefix}blocked`,
        `${prefix}group:${groupId}:active`,
        `${prefix}group:${groupId}:jobs`,
        `${prefix}ready`,
        `${prefix}signal`,
        `${prefix}group:${groupId}:error`,
        groupId,
      );

      res.json({ ok: true, wasBlocked: result === 1 });
    } catch (err) {
      console.error("unblock error:", err);
      res.status(500).json({ error: err instanceof Error ? err.message : "Internal error" });
    }
  });

  router.post("/api/actions/unblock-all", async (req, res) => {
    try {
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

      if (blockedMembers.length === 0) {
        res.json({ ok: true, unblockedCount: 0 });
        return;
      }

      // Use a pipeline to send all evals in a single round trip instead of
      // N sequential awaits which can hang with many blocked groups.
      const pipeline = redis.pipeline();
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

      res.json({ ok: true, unblockedCount });
    } catch (err) {
      console.error("unblock-all error:", err);
      res.status(500).json({ error: err instanceof Error ? err.message : "Internal error" });
    }
  });

  router.post("/api/actions/drain-group", async (req, res) => {
    try {
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

      res.json({ ok: true, jobsRemoved: result });
    } catch (err) {
      console.error("drain-group error:", err);
      res.status(500).json({ error: err instanceof Error ? err.message : "Internal error" });
    }
  });

  router.post("/api/actions/retry-blocked", async (req, res) => {
    try {
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

      // 1. Retry the failed BullMQ job (only for non-group queues; group queues
      //    use fastq — the job is already re-staged by restageAndBlock, so
      //    unblocking the group is sufficient to resume processing)
      const retried = isGroupQueue(queueName) ? true : await retryJob(redis, queueName, jobId);

      // 2. Unblock the group
      const prefix = `${queueName}:gq:`;
      const unblocked = await redis.eval(
        UNBLOCK_LUA, 6,
        `${prefix}blocked`,
        `${prefix}group:${groupId}:active`,
        `${prefix}group:${groupId}:jobs`,
        `${prefix}ready`,
        `${prefix}signal`,
        `${prefix}group:${groupId}:error`,
        groupId,
      );

      res.json({ ok: true, retried, unblocked: unblocked === 1 });
    } catch (err) {
      console.error("retry-blocked error:", err);
      res.status(500).json({ error: err instanceof Error ? err.message : "Internal error" });
    }
  });

  router.post("/api/actions/pause", async (req, res) => {
    try {
      const { queueName, pauseKey } = req.body as { queueName?: string; pauseKey?: string };
      if (!queueName || !pauseKey) {
        res.status(400).json({ error: "queueName and pauseKey are required" });
        return;
      }

      if (!getGroupQueueNames().includes(queueName)) {
        res.status(404).json({ error: "Unknown queue name" });
        return;
      }

      await redis.sadd(`${queueName}:gq:paused-jobs`, pauseKey);
      res.json({ ok: true });
    } catch (err) {
      console.error("pause error:", err);
      res.status(500).json({ error: err instanceof Error ? err.message : "Internal error" });
    }
  });

  router.post("/api/actions/unpause", async (req, res) => {
    try {
      const { queueName, pauseKey } = req.body as { queueName?: string; pauseKey?: string };
      if (!queueName || !pauseKey) {
        res.status(400).json({ error: "queueName and pauseKey are required" });
        return;
      }

      if (!getGroupQueueNames().includes(queueName)) {
        res.status(404).json({ error: "Unknown queue name" });
        return;
      }

      await redis.srem(`${queueName}:gq:paused-jobs`, pauseKey);
      // Wake the dispatcher so parked jobs get picked up quickly
      await redis.lpush(`${queueName}:gq:signal`, "1");
      res.json({ ok: true });
    } catch (err) {
      console.error("unpause error:", err);
      res.status(500).json({ error: err instanceof Error ? err.message : "Internal error" });
    }
  });

  router.get("/api/actions/paused", async (req, res) => {
    try {
      const queueName = req.query.queueName as string | undefined;
      if (!queueName) {
        res.status(400).json({ error: "queueName query param is required" });
        return;
      }

      if (!getGroupQueueNames().includes(queueName)) {
        res.status(404).json({ error: "Unknown queue name" });
        return;
      }

      const pausedKeys = await redis.smembers(`${queueName}:gq:paused-jobs`);
      res.json({ pausedKeys });
    } catch (err) {
      console.error("paused error:", err);
      res.status(500).json({ error: err instanceof Error ? err.message : "Internal error" });
    }
  });

  return router;
}
