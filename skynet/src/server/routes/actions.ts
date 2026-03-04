import { Router } from "express";
import rateLimit from "express-rate-limit";
import type IORedis from "ioredis";
import { createLogger } from "../logger.ts";
import { GroupQueueActionService } from "../services/groupQueueActionService.ts";
import { isValidGroupId, isValidPauseKey } from "./validators.ts";

const logger = createLogger("actions");

const pauseRateLimiter = rateLimit({ windowMs: 60_000, max: 30 });
const actionRateLimiter = rateLimit({ windowMs: 60_000, max: 60 });

export function createActionsRouter(redis: IORedis, getGroupQueueNames: () => string[]): Router {
  const router = Router();
  const service = new GroupQueueActionService(redis, getGroupQueueNames);

  router.post("/api/actions/unblock", actionRateLimiter, async (req, res) => {
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

      if (!service.isKnownQueue(queueName)) {
        res.status(404).json({ error: "Unknown queue name" });
        return;
      }

      const result = await service.unblockGroup({ queueName, groupId });
      res.json({ ok: true, wasBlocked: result.wasBlocked });
    } catch (err) {
      logger.error({ context: { err: err instanceof Error ? err.message : String(err) }, message: "unblock error" });
      res.status(500).json({ error: "Internal error" });
    }
  });

  router.post("/api/actions/unblock-all", actionRateLimiter, async (req, res) => {
    try {
      const { queueName } = req.body as { queueName?: string };
      if (!queueName) {
        res.status(400).json({ error: "queueName is required" });
        return;
      }

      if (!service.isKnownQueue(queueName)) {
        res.status(404).json({ error: "Unknown queue name" });
        return;
      }

      const result = await service.unblockAll({ queueName });
      res.json({ ok: true, unblockedCount: result.unblockedCount });
    } catch (err) {
      logger.error({ context: { err: err instanceof Error ? err.message : String(err) }, message: "unblock-all error" });
      res.status(500).json({ error: "Internal error" });
    }
  });

  router.post("/api/actions/drain-group", actionRateLimiter, async (req, res) => {
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

      if (!service.isKnownQueue(queueName)) {
        res.status(404).json({ error: "Unknown queue name" });
        return;
      }

      const result = await service.drainGroup({ queueName, groupId });
      res.json({ ok: true, jobsRemoved: result.jobsRemoved });
    } catch (err) {
      logger.error({ context: { err: err instanceof Error ? err.message : String(err) }, message: "drain-group error" });
      res.status(500).json({ error: "Internal error" });
    }
  });

  router.post("/api/actions/retry-blocked", actionRateLimiter, async (req, res) => {
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

      if (!service.isKnownQueue(queueName)) {
        res.status(404).json({ error: "Unknown queue name" });
        return;
      }

      const result = await service.retryBlocked({ queueName, groupId, jobId });
      res.json({ ok: true, retried: result.retried, unblocked: result.unblocked });
    } catch (err) {
      logger.error({ context: { err: err instanceof Error ? err.message : String(err) }, message: "retry-blocked error" });
      res.status(500).json({ error: "Internal error" });
    }
  });

  router.post("/api/actions/pause", pauseRateLimiter, async (req, res) => {
    try {
      const { queueName, pauseKey } = req.body as { queueName?: string; pauseKey?: string };
      if (!queueName || !pauseKey) {
        res.status(400).json({ error: "queueName and pauseKey are required" });
        return;
      }

      if (!isValidPauseKey(pauseKey)) {
        res.status(400).json({ error: "Invalid pauseKey format (max 200 chars, alphanumeric/dash/underscore/slash only)" });
        return;
      }

      if (!service.isKnownQueue(queueName)) {
        res.status(404).json({ error: "Unknown queue name" });
        return;
      }

      await service.pauseKey({ queueName, pauseKey });
      res.json({ ok: true });
    } catch (err) {
      logger.error({ context: { err: err instanceof Error ? err.message : String(err) }, message: "pause error" });
      res.status(500).json({ error: "Internal error" });
    }
  });

  router.post("/api/actions/unpause", pauseRateLimiter, async (req, res) => {
    try {
      const { queueName, pauseKey } = req.body as { queueName?: string; pauseKey?: string };
      if (!queueName || !pauseKey) {
        res.status(400).json({ error: "queueName and pauseKey are required" });
        return;
      }

      if (!isValidPauseKey(pauseKey)) {
        res.status(400).json({ error: "Invalid pauseKey format (max 200 chars, alphanumeric/dash/underscore/slash only)" });
        return;
      }

      if (!service.isKnownQueue(queueName)) {
        res.status(404).json({ error: "Unknown queue name" });
        return;
      }

      await service.unpauseKey({ queueName, pauseKey });
      res.json({ ok: true });
    } catch (err) {
      logger.error({ context: { err: err instanceof Error ? err.message : String(err) }, message: "unpause error" });
      res.status(500).json({ error: "Internal error" });
    }
  });

  router.get("/api/actions/paused", pauseRateLimiter, async (req, res) => {
    try {
      const queueName = req.query.queueName as string | undefined;
      if (!queueName) {
        res.status(400).json({ error: "queueName query param is required" });
        return;
      }

      if (!service.isKnownQueue(queueName)) {
        res.status(404).json({ error: "Unknown queue name" });
        return;
      }

      if (!service.isKnownQueue(queueName)) {
        res.status(404).json({ error: "Unknown queue name" });
        return;
      }

      const pausedKeys = await service.listPausedKeys({ queueName });
      res.json({ pausedKeys });
    } catch (err) {
      logger.error({ context: { err: err instanceof Error ? err.message : String(err) }, message: "paused error" });
      res.status(500).json({ error: "Internal error" });
    }
  });

  return router;
}
