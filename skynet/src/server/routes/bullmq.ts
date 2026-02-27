import { Router } from "express";
import type IORedis from "ioredis";
import { getFailedJobs, retryJob, removeJob, retryAllFailed, removeAllFailed, removeAllByState, retryAllByState, getQueueInfos, getJobsByState, getJobById, promoteJob } from "../services/bullmqService.ts";
import type { BullMQJobState } from "../../shared/types.ts";

export function createBullMQRouter(redis: IORedis, getQueueNames: () => string[]): Router {
  const router = Router();

  router.get("/api/bullmq/failed", async (req, res) => {
    const page = parseInt(req.query.page as string ?? "0", 10);
    const pageSize = parseInt(req.query.pageSize as string ?? "50", 10);

    try {
      const result = await getFailedJobs(redis, getQueueNames(), { page, pageSize });
      res.json(result);
    } catch (err) {
      console.error("Failed jobs error:", err);
      res.status(500).json({ error: "Failed to fetch failed jobs" });
    }
  });

  router.post("/api/bullmq/retry", async (req, res) => {
    const { queueName, jobId } = req.body as { queueName?: string; jobId?: string };
    if (!queueName || !jobId) {
      res.status(400).json({ error: "queueName and jobId are required" });
      return;
    }

    try {
      const success = await retryJob(redis, queueName, jobId);
      res.json({ ok: success });
    } catch (err) {
      console.error("Retry error:", err);
      res.status(500).json({ error: "Failed to retry job" });
    }
  });

  router.post("/api/bullmq/remove", async (req, res) => {
    const { queueName, jobId } = req.body as { queueName?: string; jobId?: string };
    if (!queueName || !jobId) {
      res.status(400).json({ error: "queueName and jobId are required" });
      return;
    }

    try {
      const success = await removeJob(redis, queueName, jobId);
      res.json({ ok: success });
    } catch (err) {
      console.error("Remove error:", err);
      res.status(500).json({ error: "Failed to remove job" });
    }
  });

  router.post("/api/bullmq/retry-all-failed", async (_req, res) => {
    try {
      const result = await retryAllFailed(redis, getQueueNames());
      res.json(result);
    } catch (err) {
      console.error("Retry all failed error:", err);
      res.status(500).json({ error: "Failed to retry all failed jobs" });
    }
  });

  router.post("/api/bullmq/remove-all-failed", async (_req, res) => {
    try {
      const result = await removeAllFailed(redis, getQueueNames());
      res.json(result);
    } catch (err) {
      console.error("Remove all failed error:", err);
      res.status(500).json({ error: "Failed to remove all failed jobs" });
    }
  });

  const removableStates = new Set(["failed", "delayed", "completed", "waiting"]);

  router.post("/api/bullmq/queues/:queueName/remove-all", async (req, res) => {
    const queueName = decodeURIComponent(req.params.queueName!);
    const { state } = req.body as { state?: string };

    if (!state || !removableStates.has(state)) {
      res.status(400).json({ error: `Invalid state: ${state}` });
      return;
    }
    if (!getQueueNames().includes(queueName)) {
      res.status(404).json({ error: `Queue not found: ${queueName}` });
      return;
    }

    try {
      const result = await removeAllByState(redis, queueName, state as "failed" | "delayed" | "completed" | "waiting");
      res.json(result);
    } catch (err) {
      console.error("Remove all error:", err);
      res.status(500).json({ error: "Failed to remove jobs" });
    }
  });

  router.post("/api/bullmq/queues/:queueName/retry-all", async (req, res) => {
    const queueName = decodeURIComponent(req.params.queueName!);

    if (!getQueueNames().includes(queueName)) {
      res.status(404).json({ error: `Queue not found: ${queueName}` });
      return;
    }

    try {
      const result = await retryAllByState(redis, queueName);
      res.json(result);
    } catch (err) {
      console.error("Retry all error:", err);
      res.status(500).json({ error: "Failed to retry jobs" });
    }
  });

  const validStates = new Set<BullMQJobState>(["waiting", "active", "completed", "failed", "delayed"]);

  router.get("/api/bullmq/queues/:queueName/jobs", async (req, res) => {
    const queueName = decodeURIComponent(req.params.queueName!);
    const state = (req.query.state as string) ?? "waiting";
    const page = parseInt(req.query.page as string ?? "0", 10);

    if (!validStates.has(state as BullMQJobState)) {
      res.status(400).json({ error: `Invalid state: ${state}` });
      return;
    }

    if (!getQueueNames().includes(queueName)) {
      res.status(404).json({ error: `Queue not found: ${queueName}` });
      return;
    }

    try {
      const result = await getJobsByState(redis, queueName, { state: state as BullMQJobState, page });
      res.json(result);
    } catch (err) {
      console.error("Queue jobs error:", err);
      res.status(500).json({ error: "Failed to fetch queue jobs" });
    }
  });

  router.get("/api/bullmq/queues/:queueName/jobs/:jobId", async (req, res) => {
    const queueName = decodeURIComponent(req.params.queueName!);
    const jobId = req.params.jobId!;

    if (!getQueueNames().includes(queueName)) {
      res.status(404).json({ error: `Queue not found: ${queueName}` });
      return;
    }

    try {
      const job = await getJobById(redis, queueName, jobId);
      if (!job) {
        res.status(404).json({ error: `Job not found: ${jobId}` });
        return;
      }
      res.json(job);
    } catch (err) {
      console.error("Job detail error:", err);
      res.status(500).json({ error: "Failed to fetch job" });
    }
  });

  router.post("/api/bullmq/promote", async (req, res) => {
    const { queueName, jobId } = req.body as { queueName?: string; jobId?: string };
    if (!queueName || !jobId) {
      res.status(400).json({ error: "queueName and jobId are required" });
      return;
    }

    try {
      const success = await promoteJob(redis, queueName, jobId);
      res.json({ ok: success });
    } catch (err) {
      console.error("Promote error:", err);
      res.status(500).json({ error: "Failed to promote job" });
    }
  });

  router.get("/api/bullmq/queues", async (_req, res) => {
    try {
      const queues = await getQueueInfos(redis, getQueueNames());
      res.json({ queues });
    } catch (err) {
      console.error("Queue info error:", err);
      res.status(500).json({ error: "Failed to fetch queue info" });
    }
  });

  return router;
}
