import { Queue, Job } from "bullmq";
import type IORedis from "ioredis";

// Known queue names from the codebase
export const KNOWN_QUEUES = [
  "{evaluations}",
  "{collector}",
  "{track_events}",
  "{topic_clustering}",
  "{usage_stats}",
] as const;

export interface QueueStats {
  name: string;
  waiting: number;
  active: number;
  completed: number;
  failed: number;
  delayed: number;
  paused: number;
}

export interface JobInfo {
  id: string;
  name: string;
  data: unknown;
  opts: Record<string, unknown>;
  progress: unknown;
  attemptsMade: number;
  failedReason?: string;
  stacktrace: string[];
  returnvalue: unknown;
  finishedOn?: number;
  processedOn?: number;
  timestamp: number;
  state: string;
}

export async function discoverQueues(connection: IORedis): Promise<string[]> {
  const keys = await connection.keys("bull:*:id");
  const queueNames = keys
    .map((key) => {
      const match = key.match(/^bull:(.+):id$/);
      return match?.[1];
    })
    .filter((name): name is string => !!name)
    .sort();

  return [...new Set(queueNames)];
}

export async function getQueueStats(
  queueName: string,
  connection: IORedis
): Promise<QueueStats> {
  const queue = new Queue(queueName, { connection });

  try {
    const [waiting, active, completed, failed, delayed, isPaused] =
      await Promise.all([
        queue.getWaitingCount(),
        queue.getActiveCount(),
        queue.getCompletedCount(),
        queue.getFailedCount(),
        queue.getDelayedCount(),
        queue.isPaused(),
      ]);

    return {
      name: queueName,
      waiting,
      active,
      completed,
      failed,
      delayed,
      paused: isPaused ? 1 : 0,
    };
  } finally {
    await queue.close();
  }
}

export async function getAllQueueStats(
  connection: IORedis
): Promise<QueueStats[]> {
  const queueNames = await discoverQueues(connection);
  const stats = await Promise.all(
    queueNames.map((name) => getQueueStats(name, connection))
  );
  return stats;
}

export async function getJob(
  queueName: string,
  jobId: string,
  connection: IORedis
): Promise<JobInfo | null> {
  const queue = new Queue(queueName, { connection });

  try {
    const job = await queue.getJob(jobId);
    if (!job) {
      return null;
    }

    const state = await job.getState();

    return {
      id: job.id ?? "",
      name: job.name,
      data: job.data,
      opts: job.opts as unknown as Record<string, unknown>,
      progress: job.progress,
      attemptsMade: job.attemptsMade,
      failedReason: job.failedReason,
      stacktrace: job.stacktrace,
      returnvalue: job.returnvalue,
      finishedOn: job.finishedOn,
      processedOn: job.processedOn,
      timestamp: job.timestamp,
      state,
    };
  } finally {
    await queue.close();
  }
}

export async function getFailedJobs(
  queueName: string,
  connection: IORedis,
  start = 0,
  end = 100
): Promise<Job[]> {
  const queue = new Queue(queueName, { connection });

  try {
    return await queue.getFailed(start, end);
  } finally {
    await queue.close();
  }
}

export interface RequeueOptions {
  resetAttempts?: boolean;
  delay?: number;
}

export async function requeueJob(
  queueName: string,
  jobId: string,
  connection: IORedis,
  options: RequeueOptions = {}
): Promise<{ success: boolean; newJobId?: string; error?: string }> {
  const { resetAttempts = true, delay = 0 } = options;

  const queue = new Queue(queueName, { connection });

  try {
    const job = await queue.getJob(jobId);
    if (!job) {
      return { success: false, error: `Job ${jobId} not found` };
    }

    // Get job data before any modifications
    const { data, name, opts } = job;

    // Create new job options, optionally resetting attempts
    const newOpts = {
      ...opts,
      delay,
      // Remove attempt-related fields when resetting
      ...(resetAttempts
        ? {
            attempts: opts.attempts ?? 3,
          }
        : {}),
    };

    // ATOMIC SAFETY: Add the new job FIRST, then remove the old one
    // This ensures we never lose a message - worst case we have a duplicate
    // which is better than losing the job entirely
    const newJob = await queue.add(name, data, newOpts);

    // Only remove the old job after the new one is successfully added
    await job.remove();

    return { success: true, newJobId: newJob.id };
  } finally {
    await queue.close();
  }
}

export async function requeueFailedJobs(
  queueName: string,
  connection: IORedis,
  options: RequeueOptions & { filter?: (job: Job) => boolean } = {}
): Promise<{ total: number; requeued: number; errors: string[] }> {
  const { filter, ...requeueOpts } = options;

  const queue = new Queue(queueName, { connection });
  const errors: string[] = [];
  let requeued = 0;

  try {
    const failedJobs = await queue.getFailed(0, -1);
    const jobsToRequeue = filter ? failedJobs.filter(filter) : failedJobs;

    for (const job of jobsToRequeue) {
      if (!job.id) continue;

      const result = await requeueJob(queueName, job.id, connection, requeueOpts);
      if (result.success) {
        requeued++;
      } else {
        errors.push(`Job ${job.id}: ${result.error}`);
      }
    }

    return { total: jobsToRequeue.length, requeued, errors };
  } finally {
    await queue.close();
  }
}

export async function retryJob(
  queueName: string,
  jobId: string,
  connection: IORedis
): Promise<{ success: boolean; error?: string }> {
  const queue = new Queue(queueName, { connection });

  try {
    const job = await queue.getJob(jobId);
    if (!job) {
      return { success: false, error: `Job ${jobId} not found` };
    }

    await job.retry();
    return { success: true };
  } finally {
    await queue.close();
  }
}

export async function removeJob(
  queueName: string,
  jobId: string,
  connection: IORedis
): Promise<{ success: boolean; error?: string }> {
  const queue = new Queue(queueName, { connection });

  try {
    const job = await queue.getJob(jobId);
    if (!job) {
      return { success: false, error: `Job ${jobId} not found` };
    }

    await job.remove();
    return { success: true };
  } finally {
    await queue.close();
  }
}

export async function drainQueue(
  queueName: string,
  connection: IORedis,
  delayed = true
): Promise<void> {
  const queue = new Queue(queueName, { connection });

  try {
    await queue.drain(delayed);
  } finally {
    await queue.close();
  }
}

export async function cleanQueue(
  queueName: string,
  connection: IORedis,
  grace: number,
  status: "completed" | "wait" | "active" | "paused" | "prioritized" | "delayed" | "failed"
): Promise<string[]> {
  const queue = new Queue(queueName, { connection });

  try {
    return await queue.clean(grace, -1, status);
  } finally {
    await queue.close();
  }
}
