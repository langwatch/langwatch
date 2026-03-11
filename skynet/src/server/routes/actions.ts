import { Router } from "express";
import type IORedis from "ioredis";
import { createLogger } from "../logger.ts";
import { GroupQueueActionService } from "../services/groupQueueActionService.ts";
import { isValidGroupId, isValidPauseKey } from "./validators.ts";

const logger = createLogger("actions");

export function createActionsRouter(redis: IORedis, getGroupQueueNames: () => string[]): Router {
  const router = Router();
  const service = new GroupQueueActionService(redis, getGroupQueueNames);

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

  router.post("/api/actions/unblock-all", async (req, res) => {
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

  router.post("/api/actions/pause", async (req, res) => {
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

  router.post("/api/actions/unpause", async (req, res) => {
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

  router.get("/api/actions/paused", async (req, res) => {
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

  router.post("/api/actions/drain-all-blocked", async (req, res) => {
    try {
      const { queueName, pipelineFilter, errorFilter } = req.body as { queueName?: string; pipelineFilter?: string; errorFilter?: string };
      if (!queueName) {
        res.status(400).json({ error: "queueName is required" });
        return;
      }
      if (!service.isKnownQueue(queueName)) {
        res.status(404).json({ error: "Unknown queue name" });
        return;
      }

      const result = await service.drainAllBlocked({ queueName, pipelineFilter, errorFilter });
      res.json({ ok: true, drainedCount: result.drainedCount, jobsRemoved: result.jobsRemoved });
    } catch (err) {
      logger.error({ context: { err: err instanceof Error ? err.message : String(err) }, message: "drain-all-blocked error" });
      res.status(500).json({ error: "Internal error" });
    }
  });

  router.get("/api/actions/drain-all-blocked/preview", async (req, res) => {
    try {
      const queueName = req.query.queueName as string | undefined;
      const pipelineFilter = req.query.pipelineFilter as string | undefined;
      const errorFilter = req.query.errorFilter as string | undefined;
      if (!queueName) {
        res.status(400).json({ error: "queueName query param is required" });
        return;
      }
      if (!service.isKnownQueue(queueName)) {
        res.status(404).json({ error: "Unknown queue name" });
        return;
      }

      const result = await service.drainAllBlockedPreview({ queueName, pipelineFilter, errorFilter });
      res.json(result);
    } catch (err) {
      logger.error({ context: { err: err instanceof Error ? err.message : String(err) }, message: "drain-preview error" });
      res.status(500).json({ error: "Internal error" });
    }
  });

  router.post("/api/actions/canary-unblock", async (req, res) => {
    try {
      const { queueName, count, pipelineFilter } = req.body as { queueName?: string; count?: number; pipelineFilter?: string };
      if (!queueName) {
        res.status(400).json({ error: "queueName is required" });
        return;
      }
      if (!service.isKnownQueue(queueName)) {
        res.status(404).json({ error: "Unknown queue name" });
        return;
      }

      const result = await service.canaryUnblock({ queueName, count: count ?? 5, pipelineFilter });
      res.json({ ok: true, unblockedCount: result.unblockedCount, groupIds: result.groupIds });
    } catch (err) {
      logger.error({ context: { err: err instanceof Error ? err.message : String(err) }, message: "canary-unblock error" });
      res.status(500).json({ error: "Internal error" });
    }
  });

  router.post("/api/actions/unblock-all-batched", async (req, res) => {
    try {
      const { queueName, batchSize, delayMs } = req.body as { queueName?: string; batchSize?: number; delayMs?: number };
      if (!queueName) {
        res.status(400).json({ error: "queueName is required" });
        return;
      }
      if (!service.isKnownQueue(queueName)) {
        res.status(404).json({ error: "Unknown queue name" });
        return;
      }

      const result = await service.unblockAllBatched({ queueName, batchSize, delayMs });
      res.json({ ok: true, unblockedCount: result.unblockedCount });
    } catch (err) {
      logger.error({ context: { err: err instanceof Error ? err.message : String(err) }, message: "unblock-all-batched error" });
      res.status(500).json({ error: "Internal error" });
    }
  });

  router.post("/api/actions/move-to-dlq", async (req, res) => {
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

      const result = await service.moveToDlq({ queueName, groupId });
      res.json({ ok: true, jobsMoved: result.jobsMoved });
    } catch (err) {
      logger.error({ context: { err: err instanceof Error ? err.message : String(err) }, message: "move-to-dlq error" });
      res.status(500).json({ error: "Internal error" });
    }
  });

  router.post("/api/actions/move-all-blocked-to-dlq", async (req, res) => {
    try {
      const { queueName, pipelineFilter, errorFilter } = req.body as { queueName?: string; pipelineFilter?: string; errorFilter?: string };
      if (!queueName) {
        res.status(400).json({ error: "queueName is required" });
        return;
      }
      if (!service.isKnownQueue(queueName)) {
        res.status(404).json({ error: "Unknown queue name" });
        return;
      }

      const result = await service.moveAllBlockedToDlq({ queueName, pipelineFilter, errorFilter });
      res.json({ ok: true, movedCount: result.movedCount, jobsMoved: result.jobsMoved });
    } catch (err) {
      logger.error({ context: { err: err instanceof Error ? err.message : String(err) }, message: "move-all-blocked-to-dlq error" });
      res.status(500).json({ error: "Internal error" });
    }
  });

  router.post("/api/actions/replay-from-dlq", async (req, res) => {
    try {
      const { queueName, groupId, all } = req.body as { queueName?: string; groupId?: string; all?: boolean };
      if (!queueName) {
        res.status(400).json({ error: "queueName is required" });
        return;
      }
      if (!service.isKnownQueue(queueName)) {
        res.status(404).json({ error: "Unknown queue name" });
        return;
      }

      if (all) {
        const result = await service.replayAllFromDlq({ queueName });
        res.json({ ok: true, replayedCount: result.replayedCount, jobsReplayed: result.jobsReplayed });
      } else {
        if (!groupId) {
          res.status(400).json({ error: "groupId is required when all is not set" });
          return;
        }
        if (!isValidGroupId(groupId)) {
          res.status(400).json({ error: "Invalid groupId format" });
          return;
        }
        const result = await service.replayFromDlq({ queueName, groupId });
        res.json({ ok: true, jobsReplayed: result.jobsReplayed });
      }
    } catch (err) {
      logger.error({ context: { err: err instanceof Error ? err.message : String(err) }, message: "replay-from-dlq error" });
      res.status(500).json({ error: "Internal error" });
    }
  });

  return router;
}
