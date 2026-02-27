import { Queue } from "bullmq";
import type IORedis from "ioredis";
import type { BullMQQueueInfo, BullMQJob, BullMQJobsPage, BullMQJobState, FailedJob } from "../../shared/types.ts";
import { FAILED_JOBS_PAGE_SIZE, BULLMQ_JOBS_PAGE_SIZE } from "../../shared/constants.ts";
import { stripHashTag } from "./queueDiscovery.ts";

const queueCache = new Map<string, Queue>();

function getQueue(name: string, connection: IORedis): Queue {
  let q = queueCache.get(name);
  if (!q) {
    q = new Queue(name, { connection });
    queueCache.set(name, q);
  }
  return q;
}

/** Evict cached Queue instances for queues no longer in the discovered set */
export function evictStaleQueueCache(currentNames: string[]): void {
  const currentSet = new Set(currentNames);
  for (const [name, queue] of queueCache) {
    if (!currentSet.has(name)) {
      queue.close().catch(() => {});
      queueCache.delete(name);
    }
  }
}

export async function getFailedJobs(
  connection: IORedis,
  queueNames: string[],
  { page = 0, pageSize = FAILED_JOBS_PAGE_SIZE }: { page?: number; pageSize?: number } = {},
): Promise<{ jobs: FailedJob[]; total: number }> {
  // Fetch failed jobs from all queues in parallel
  const perQueueResults = await Promise.all(
    queueNames.map(async (name) => {
      const queue = getQueue(name, connection);
      // Fetch up to 1000 failed jobs per queue (increased from 500)
      const failed = await queue.getFailed(0, 1000);

      return failed.map((job) => {
        let pipelineName: string | null = null;
        let jobType: string | null = null;
        let jobName: string | null = null;

        if (job.data) {
          pipelineName = (job.data as Record<string, unknown>).__pipelineName as string ?? null;
          jobType = (job.data as Record<string, unknown>).__jobType as string ?? null;
          jobName = (job.data as Record<string, unknown>).__jobName as string ?? null;
        }

        return {
          id: job.id ?? "unknown",
          name: job.name,
          data: job.data as Record<string, unknown>,
          failedReason: job.failedReason ?? "Unknown",
          stacktrace: job.stacktrace ?? [],
          attemptsMade: job.attemptsMade,
          timestamp: job.timestamp,
          finishedOn: job.finishedOn ?? null,
          queueName: name,
          queueDisplayName: stripHashTag(name),
          pipelineName,
          jobType,
          jobName,
        } satisfies FailedJob;
      });
    }),
  );

  const allFailed = perQueueResults.flat();
  allFailed.sort((a, b) => (b.finishedOn ?? b.timestamp) - (a.finishedOn ?? a.timestamp));

  const start = page * pageSize;
  return {
    jobs: allFailed.slice(start, start + pageSize),
    total: allFailed.length,
  };
}

export async function retryJob(connection: IORedis, queueName: string, jobId: string): Promise<boolean> {
  const queue = getQueue(queueName, connection);
  const job = await queue.getJob(jobId);
  if (!job) return false;
  await job.retry();
  return true;
}

export async function removeJob(connection: IORedis, queueName: string, jobId: string): Promise<boolean> {
  const queue = getQueue(queueName, connection);
  const job = await queue.getJob(jobId);
  if (!job) return false;
  await job.remove();
  return true;
}

function toBullMQJob(job: Awaited<ReturnType<Queue["getJob"]>>, queueName: string, state: BullMQJobState): BullMQJob | null {
  if (!job) return null;
  return {
    id: job.id ?? "unknown",
    name: job.name,
    queueName,
    queueDisplayName: stripHashTag(queueName),
    state,
    data: job.data as Record<string, unknown>,
    returnvalue: job.returnvalue ?? null,
    failedReason: job.failedReason ?? null,
    stacktrace: job.stacktrace ?? [],
    attemptsMade: job.attemptsMade,
    timestamp: job.timestamp,
    processedOn: job.processedOn ?? null,
    finishedOn: job.finishedOn ?? null,
    delay: job.delay ?? 0,
    progress: (typeof job.progress === "number" || typeof job.progress === "string") ? job.progress : 0,
    opts: job.opts as Record<string, unknown>,
  };
}

export async function getJobsByState(
  connection: IORedis,
  queueName: string,
  { state, page = 0, pageSize = BULLMQ_JOBS_PAGE_SIZE }: { state: BullMQJobState; page?: number; pageSize?: number },
): Promise<BullMQJobsPage> {
  const queue = getQueue(queueName, connection);
  const counts = await queue.getJobCounts();
  const total = counts[state] ?? 0;
  const start = page * pageSize;
  const end = start + pageSize - 1;
  const rawJobs = await queue.getJobs([state], start, end);

  const jobs: BullMQJob[] = [];
  for (const raw of rawJobs) {
    const mapped = toBullMQJob(raw, queueName, state);
    if (mapped) jobs.push(mapped);
  }

  return {
    jobs,
    total,
    page,
    pageSize,
    totalPages: Math.max(1, Math.ceil(total / pageSize)),
    state,
  };
}

export async function getJobById(
  connection: IORedis,
  queueName: string,
  jobId: string,
): Promise<BullMQJob | null> {
  const queue = getQueue(queueName, connection);
  const job = await queue.getJob(jobId);
  if (!job) return null;
  const state = await job.getState() as BullMQJobState;
  return toBullMQJob(job, queueName, state);
}

export async function promoteJob(
  connection: IORedis,
  queueName: string,
  jobId: string,
): Promise<boolean> {
  const queue = getQueue(queueName, connection);
  const job = await queue.getJob(jobId);
  if (!job) return false;
  await job.promote();
  return true;
}

const BATCH_SIZE = 1000;

export async function removeAllByState(
  connection: IORedis,
  queueName: string,
  state: "failed" | "delayed" | "completed" | "waiting",
): Promise<{ removed: number }> {
  const queue = getQueue(queueName, connection);
  let removed = 0;
  // Loop until all jobs in the state are processed
  let hasMore = true;
  while (hasMore) {
    const jobs = await queue.getJobs([state], 0, BATCH_SIZE);
    if (jobs.length === 0) break;
    hasMore = jobs.length === BATCH_SIZE;
    for (const job of jobs) {
      try {
        await job.remove();
        removed++;
      } catch {
        // Job may have changed state or already been removed
      }
    }
  }
  return { removed };
}

export async function retryAllByState(
  connection: IORedis,
  queueName: string,
): Promise<{ retried: number }> {
  const queue = getQueue(queueName, connection);
  let retried = 0;
  // Loop until all failed jobs are processed
  let hasMore = true;
  while (hasMore) {
    const jobs = await queue.getJobs(["failed"], 0, BATCH_SIZE);
    if (jobs.length === 0) break;
    hasMore = jobs.length === BATCH_SIZE;
    for (const job of jobs) {
      try {
        await job.retry();
        retried++;
      } catch {
        // Job may have changed state
      }
    }
  }
  return { retried };
}

export async function retryAllFailed(
  connection: IORedis,
  queueNames: string[],
): Promise<{ retried: number }> {
  // Process all queues in parallel
  const results = await Promise.all(
    queueNames.map(async (name) => {
      const queue = getQueue(name, connection);
      let retried = 0;
      let hasMore = true;
      while (hasMore) {
        const failed = await queue.getFailed(0, BATCH_SIZE);
        if (failed.length === 0) break;
        hasMore = failed.length === BATCH_SIZE;
        for (const job of failed) {
          try {
            await job.retry();
            retried++;
          } catch {
            // Job may have been removed or already retried
          }
        }
      }
      return retried;
    }),
  );
  return { retried: results.reduce((sum, r) => sum + r, 0) };
}

export async function removeAllFailed(
  connection: IORedis,
  queueNames: string[],
): Promise<{ removed: number }> {
  // Process all queues in parallel
  const results = await Promise.all(
    queueNames.map(async (name) => {
      const queue = getQueue(name, connection);
      let removed = 0;
      let hasMore = true;
      while (hasMore) {
        const failed = await queue.getFailed(0, BATCH_SIZE);
        if (failed.length === 0) break;
        hasMore = failed.length === BATCH_SIZE;
        for (const job of failed) {
          try {
            await job.remove();
            removed++;
          } catch {
            // Job may have already been removed
          }
        }
      }
      return removed;
    }),
  );
  return { removed: results.reduce((sum, r) => sum + r, 0) };
}

export async function getCompletedJobsForGroup(
  connection: IORedis,
  queueName: string,
  groupId: string,
  { limit = 50 }: { limit?: number } = {},
): Promise<BullMQJob[]> {
  const queue = getQueue(queueName, connection);
  const completed = await queue.getCompleted(0, 500);

  const matching: BullMQJob[] = [];
  for (const job of completed) {
    const data = job.data as Record<string, unknown>;
    if (data.__groupId === groupId) {
      const mapped = toBullMQJob(job, queueName, "completed");
      if (mapped) matching.push(mapped);
      if (matching.length >= limit) break;
    }
  }

  matching.sort((a, b) => (b.finishedOn ?? b.timestamp) - (a.finishedOn ?? a.timestamp));
  return matching;
}

export async function getQueueInfos(connection: IORedis, queueNames: string[]): Promise<BullMQQueueInfo[]> {
  // Fetch all queue info in parallel instead of sequentially
  return Promise.all(
    queueNames.map(async (name) => {
      const queue = getQueue(name, connection);
      const counts = await queue.getJobCounts();
      return {
        name,
        displayName: stripHashTag(name),
        waiting: counts.waiting ?? 0,
        active: counts.active ?? 0,
        completed: counts.completed ?? 0,
        failed: counts.failed ?? 0,
        delayed: counts.delayed ?? 0,
      } satisfies BullMQQueueInfo;
    }),
  );
}
