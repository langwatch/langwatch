import { Router } from "express";
import type IORedis from "ioredis";
import { UNBLOCK_LUA, DRAIN_GROUP_LUA } from "../services/luaScripts.ts";

export function createActionsRouter(redis: IORedis, getGroupQueueNames: () => string[]): Router {
  const router = Router();

  router.post("/api/actions/unblock", async (req, res) => {
    const { queueName, groupId } = req.body as { queueName?: string; groupId?: string };
    if (!queueName || !groupId) {
      res.status(400).json({ error: "queueName and groupId are required" });
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

  return router;
}
