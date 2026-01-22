import chalk from "chalk";
import type IORedis from "ioredis";
import { getJob, discoverQueues } from "../lib/queues.js";

function formatTimestamp(ts?: number): string {
  if (!ts) return "N/A";
  return new Date(ts).toISOString();
}

function formatDuration(start?: number, end?: number): string {
  if (!start || !end) return "N/A";
  const ms = end - start;
  if (ms < 1000) return `${ms}ms`;
  if (ms < 60000) return `${(ms / 1000).toFixed(2)}s`;
  return `${(ms / 60000).toFixed(2)}m`;
}

export async function inspectJob(
  connection: IORedis,
  jobId: string,
  queueName?: string
): Promise<void> {
  let queues: string[];

  if (queueName) {
    queues = [queueName];
  } else {
    console.log(chalk.blue("Searching for job across all queues..."));
    queues = await discoverQueues(connection);
  }

  for (const queue of queues) {
    const job = await getJob(queue, jobId, connection);

    if (job) {
      console.log(chalk.green(`\n✓ Found job in queue: ${chalk.bold(queue)}\n`));

      console.log(chalk.white.bold("=== Job Info ==="));
      console.log(`${chalk.gray("ID:")}          ${job.id}`);
      console.log(`${chalk.gray("Name:")}        ${job.name}`);
      console.log(`${chalk.gray("State:")}       ${formatState(job.state)}`);
      console.log(`${chalk.gray("Attempts:")}    ${job.attemptsMade}/${job.opts.attempts ?? "∞"}`);
      console.log(`${chalk.gray("Created:")}     ${formatTimestamp(job.timestamp)}`);
      console.log(`${chalk.gray("Processed:")}   ${formatTimestamp(job.processedOn)}`);
      console.log(`${chalk.gray("Finished:")}    ${formatTimestamp(job.finishedOn)}`);
      console.log(
        `${chalk.gray("Duration:")}    ${formatDuration(job.processedOn, job.finishedOn)}`
      );

      if (job.opts.delay) {
        console.log(`${chalk.gray("Delay:")}       ${job.opts.delay}ms`);
      }

      const backoff = job.opts.backoff as { type?: string; delay?: number } | undefined;
      if (backoff && typeof backoff === "object") {
        console.log(
          `${chalk.gray("Backoff:")}     ${backoff.type ?? "unknown"} (${backoff.delay ?? 0}ms)`
        );
      }

      if (job.failedReason) {
        console.log(chalk.red.bold("\n=== Error ==="));
        console.log(chalk.red(job.failedReason));
      }

      if (job.stacktrace && job.stacktrace.length > 0) {
        console.log(chalk.red.bold("\n=== Stack Trace ==="));
        for (const line of job.stacktrace) {
          console.log(chalk.gray(line));
        }
      }

      console.log(chalk.white.bold("\n=== Job Data ==="));
      console.log(JSON.stringify(job.data, null, 2));

      if (job.returnvalue !== undefined && job.returnvalue !== null) {
        console.log(chalk.white.bold("\n=== Return Value ==="));
        console.log(JSON.stringify(job.returnvalue, null, 2));
      }

      return;
    }
  }

  console.log(chalk.red(`\n✗ Job ${jobId} not found in any queue.`));
}

function formatState(state: string): string {
  switch (state) {
    case "completed":
      return chalk.green(state);
    case "failed":
      return chalk.red(state);
    case "active":
      return chalk.cyan(state);
    case "waiting":
      return chalk.yellow(state);
    case "delayed":
      return chalk.magenta(state);
    case "paused":
      return chalk.gray(state);
    default:
      return state;
  }
}
