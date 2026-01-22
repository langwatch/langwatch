import chalk from "chalk";
import Table from "cli-table3";
import type IORedis from "ioredis";
import { getFailedJobs, discoverQueues } from "../lib/queues.js";
import type { Job } from "bullmq";

export interface FailedJobsOptions {
  queue?: string;
  limit?: number;
  projectId?: string;
  traceId?: string;
}

function extractField(data: unknown, field: string): string | undefined {
  if (typeof data !== "object" || data === null) return undefined;
  const obj = data as Record<string, unknown>;

  // Try direct field access
  if (field in obj) {
    const value = obj[field];
    return typeof value === "string" ? value : String(value);
  }

  // Try nested access (e.g., projectId might be in data.projectId or data.payload.projectId)
  if ("payload" in obj && typeof obj.payload === "object" && obj.payload !== null) {
    const payload = obj.payload as Record<string, unknown>;
    if (field in payload) {
      const value = payload[field];
      return typeof value === "string" ? value : String(value);
    }
  }

  return undefined;
}

export async function listFailedJobs(
  connection: IORedis,
  options: FailedJobsOptions = {}
): Promise<void> {
  const { queue, limit = 50, projectId, traceId } = options;

  let queues: string[];

  if (queue) {
    queues = [queue];
  } else {
    console.log(chalk.blue("Discovering queues..."));
    queues = await discoverQueues(connection);
  }

  const allFailedJobs: Array<{ queue: string; job: Job }> = [];

  for (const queueName of queues) {
    const failed = await getFailedJobs(queueName, connection, 0, limit);
    for (const job of failed) {
      allFailedJobs.push({ queue: queueName, job });
    }
  }

  // Apply filters
  let filteredJobs = allFailedJobs;

  if (projectId) {
    filteredJobs = filteredJobs.filter(({ job }) => {
      const jobProjectId = extractField(job.data, "projectId");
      return jobProjectId === projectId;
    });
  }

  if (traceId) {
    filteredJobs = filteredJobs.filter(({ job }) => {
      const jobTraceId = extractField(job.data, "traceId");
      return jobTraceId === traceId;
    });
  }

  if (filteredJobs.length === 0) {
    console.log(chalk.yellow("\nNo failed jobs found matching criteria."));
    return;
  }

  console.log(chalk.red(`\n📛 Failed Jobs (${filteredJobs.length})\n`));

  const table = new Table({
    head: [
      chalk.white("Queue"),
      chalk.white("Job ID"),
      chalk.white("Name"),
      chalk.white("Attempts"),
      chalk.white("Error"),
    ],
    colWidths: [25, 20, 20, 10, 50],
    wordWrap: true,
  });

  for (const { queue: queueName, job } of filteredJobs.slice(0, limit)) {
    const errorPreview = job.failedReason
      ? job.failedReason.substring(0, 100) + (job.failedReason.length > 100 ? "..." : "")
      : "N/A";

    table.push([
      queueName,
      job.id ?? "N/A",
      job.name,
      `${job.attemptsMade}/${job.opts.attempts ?? "∞"}`,
      chalk.red(errorPreview),
    ]);
  }

  console.log(table.toString());

  if (filteredJobs.length > limit) {
    console.log(
      chalk.gray(`\nShowing ${limit} of ${filteredJobs.length} failed jobs. Use --limit to see more.`)
    );
  }
}
