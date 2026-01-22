import chalk from "chalk";
import * as readline from "readline";
import type IORedis from "ioredis";
import {
  requeueJob,
  requeueFailedJobs,
  getFailedJobs,
  discoverQueues,
  getJob,
} from "../lib/queues.js";
import type { Job } from "bullmq";

export interface RequeueOptions {
  queue?: string;
  jobId?: string;
  projectId?: string;
  traceId?: string;
  all?: boolean;
  delay?: number;
  keepAttempts?: boolean;
  yes?: boolean;
}

function askConfirmation(question: string): Promise<boolean> {
  return new Promise((resolve) => {
    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout,
    });

    rl.question(question, (answer) => {
      rl.close();
      resolve(answer.toLowerCase() === "y" || answer.toLowerCase() === "yes");
    });
  });
}

function extractField(data: unknown, field: string): string | undefined {
  if (typeof data !== "object" || data === null) return undefined;
  const obj = data as Record<string, unknown>;

  if (field in obj) {
    const value = obj[field];
    return typeof value === "string" ? value : String(value);
  }

  if ("payload" in obj && typeof obj.payload === "object" && obj.payload !== null) {
    const payload = obj.payload as Record<string, unknown>;
    if (field in payload) {
      const value = payload[field];
      return typeof value === "string" ? value : String(value);
    }
  }

  return undefined;
}

export async function requeueCommand(
  connection: IORedis,
  options: RequeueOptions
): Promise<void> {
  const {
    queue,
    jobId,
    projectId,
    traceId,
    all,
    delay = 0,
    keepAttempts = false,
    yes = false,
  } = options;

  // Single job requeue
  if (jobId && !all) {
    await requeueSingleJob(connection, jobId, queue, {
      delay,
      resetAttempts: !keepAttempts,
    });
    return;
  }

  // Bulk requeue with filters
  let queues: string[];

  if (queue) {
    queues = [queue];
  } else {
    console.log(chalk.blue("Discovering queues..."));
    queues = await discoverQueues(connection);
  }

  // Build filter function
  const filter = (job: Job): boolean => {
    if (projectId) {
      const jobProjectId = extractField(job.data, "projectId");
      if (jobProjectId !== projectId) return false;
    }
    if (traceId) {
      const jobTraceId = extractField(job.data, "traceId");
      if (jobTraceId !== traceId) return false;
    }
    return true;
  };

  // Count matching jobs first
  let totalMatching = 0;
  const matchingByQueue: Map<string, Job[]> = new Map();

  for (const queueName of queues) {
    const failed = await getFailedJobs(queueName, connection, 0, -1);
    const matching = failed.filter(filter);
    if (matching.length > 0) {
      matchingByQueue.set(queueName, matching);
      totalMatching += matching.length;
    }
  }

  if (totalMatching === 0) {
    console.log(chalk.yellow("\nNo failed jobs found matching criteria."));
    return;
  }

  // Show summary
  console.log(chalk.yellow(`\n⚠️  Found ${totalMatching} failed jobs to requeue:\n`));

  for (const [queueName, jobs] of matchingByQueue) {
    console.log(`  ${chalk.cyan(queueName)}: ${jobs.length} jobs`);
  }

  console.log();
  console.log(
    chalk.gray(
      `Options: delay=${delay}ms, resetAttempts=${!keepAttempts}`
    )
  );
  console.log();

  // Confirm unless --yes flag
  if (!yes) {
    const confirmed = await askConfirmation(`Requeue ${totalMatching} failed jobs? (y/N) `);

    if (!confirmed) {
      console.log(chalk.gray("Cancelled."));
      return;
    }
  }

  // Perform requeue
  console.log(chalk.blue("\nRequeuing jobs...\n"));

  let totalRequeued = 0;
  const allErrors: string[] = [];

  for (const [queueName, jobs] of matchingByQueue) {
    process.stdout.write(`  ${queueName}: `);

    const result = await requeueFailedJobs(queueName, connection, {
      filter: (job) => jobs.some((j) => j.id === job.id),
      delay,
      resetAttempts: !keepAttempts,
    });

    totalRequeued += result.requeued;
    allErrors.push(...result.errors);

    if (result.errors.length > 0) {
      console.log(
        chalk.yellow(`${result.requeued}/${result.total} (${result.errors.length} errors)`)
      );
    } else {
      console.log(chalk.green(`${result.requeued}/${result.total}`));
    }
  }

  console.log();
  console.log(chalk.green(`✓ Requeued ${totalRequeued}/${totalMatching} jobs`));

  if (allErrors.length > 0) {
    console.log(chalk.red(`\n${allErrors.length} errors occurred:`));
    for (const error of allErrors.slice(0, 10)) {
      console.log(chalk.red(`  - ${error}`));
    }
    if (allErrors.length > 10) {
      console.log(chalk.gray(`  ... and ${allErrors.length - 10} more`));
    }
  }
}

async function requeueSingleJob(
  connection: IORedis,
  jobId: string,
  queueName?: string,
  options: { delay: number; resetAttempts: boolean } = {
    delay: 0,
    resetAttempts: true,
  }
): Promise<void> {
  let targetQueue: string | undefined = queueName;

  // Find the queue if not specified
  if (!targetQueue) {
    console.log(chalk.blue("Searching for job..."));
    const queues = await discoverQueues(connection);

    for (const q of queues) {
      const job = await getJob(q, jobId, connection);
      if (job) {
        targetQueue = q;
        break;
      }
    }

    if (!targetQueue) {
      console.log(chalk.red(`\n✗ Job ${jobId} not found in any queue.`));
      return;
    }
  }

  console.log(chalk.blue(`\nRequeuing job ${jobId} from ${targetQueue}...`));

  const result = await requeueJob(targetQueue, jobId, connection, options);

  if (result.success) {
    console.log(
      chalk.green(`\n✓ Job requeued successfully. New job ID: ${result.newJobId}`)
    );
    if (options.resetAttempts) {
      console.log(chalk.gray("  Attempt counter has been reset."));
    }
  } else {
    console.log(chalk.red(`\n✗ Failed to requeue job: ${result.error}`));
  }
}
