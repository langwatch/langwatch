#!/usr/bin/env node

import { config } from "dotenv";
import { Command } from "commander";
import chalk from "chalk";
import React from "react";
import { render } from "ink";
import { getConnection, closeConnection } from "./lib/connection.js";
import { type Environment, isValidEnvironment } from "./lib/environments.js";
import { listQueues } from "./commands/list.js";
import { inspectJob } from "./commands/inspect.js";
import { listFailedJobs } from "./commands/failed.js";
import { requeueCommand } from "./commands/requeue.js";
import { watchQueues } from "./commands/watch.js";
import { Root } from "./ui/Root.js";

// Load environment variables
config();

const program = new Command();

function parseEnv(value: string): Environment {
  if (!isValidEnvironment(value)) {
    console.error(chalk.red(`Invalid environment: ${value}. Must be local, dev, or prod.`));
    process.exit(1);
  }
  return value;
}

program
  .name("cattleprod")
  .description("CLI tool for managing BullMQ queues")
  .version("0.0.1")
  .option("-e, --env <env>", "Environment (local, dev, prod)", "dev");

// List all queues with stats
program
  .command("list")
  .alias("ls")
  .description("List all queues with their stats")
  .action(async () => {
    const opts = program.opts();
    const env = parseEnv(opts.env);
    try {
      const connection = await getConnection(env);
      await listQueues(connection);
    } catch (error) {
      console.error(chalk.red(`Error: ${error}`));
      process.exit(1);
    } finally {
      await closeConnection();
    }
  });

// Inspect a specific job
program
  .command("inspect <jobId>")
  .alias("i")
  .description("Inspect a specific job by ID")
  .option("-q, --queue <queue>", "Queue name (searches all if not specified)")
  .action(async (jobId: string, options: { queue?: string }) => {
    const opts = program.opts();
    const env = parseEnv(opts.env);
    try {
      const connection = await getConnection(env);
      await inspectJob(connection, jobId, options.queue);
    } catch (error) {
      console.error(chalk.red(`Error: ${error}`));
      process.exit(1);
    } finally {
      await closeConnection();
    }
  });

// List failed jobs
program
  .command("failed")
  .alias("f")
  .description("List failed jobs")
  .option("-q, --queue <queue>", "Filter by queue name")
  .option("-l, --limit <limit>", "Maximum number of jobs to show", "50")
  .option("--project-id <projectId>", "Filter by project ID")
  .option("--trace-id <traceId>", "Filter by trace ID")
  .action(
    async (options: {
      queue?: string;
      limit: string;
      projectId?: string;
      traceId?: string;
    }) => {
      const opts = program.opts();
      const env = parseEnv(opts.env);
      try {
        const connection = await getConnection(env);
        await listFailedJobs(connection, {
          queue: options.queue,
          limit: parseInt(options.limit, 10),
          projectId: options.projectId,
          traceId: options.traceId,
        });
      } catch (error) {
        console.error(chalk.red(`Error: ${error}`));
        process.exit(1);
      } finally {
        await closeConnection();
      }
    }
  );

// Requeue jobs
program
  .command("requeue")
  .alias("rq")
  .description("Requeue failed jobs with reset attempt counter")
  .option("-j, --job-id <jobId>", "Specific job ID to requeue")
  .option("-q, --queue <queue>", "Filter by queue name")
  .option("--project-id <projectId>", "Filter by project ID")
  .option("--trace-id <traceId>", "Filter by trace ID")
  .option("-a, --all", "Requeue all matching failed jobs")
  .option("-d, --delay <ms>", "Delay before job is processed (ms)", "0")
  .option("--keep-attempts", "Keep existing attempt count (don't reset)")
  .option("-y, --yes", "Skip confirmation prompt")
  .action(
    async (options: {
      jobId?: string;
      queue?: string;
      projectId?: string;
      traceId?: string;
      all?: boolean;
      delay: string;
      keepAttempts?: boolean;
      yes?: boolean;
    }) => {
      const opts = program.opts();
      const env = parseEnv(opts.env);

      if (!options.jobId && !options.all) {
        console.error(chalk.red("Error: Either --job-id or --all is required"));
        process.exit(1);
      }

      try {
        const connection = await getConnection(env);
        await requeueCommand(connection, {
          jobId: options.jobId,
          queue: options.queue,
          projectId: options.projectId,
          traceId: options.traceId,
          all: options.all,
          delay: parseInt(options.delay, 10),
          keepAttempts: options.keepAttempts,
          yes: options.yes,
        });
      } catch (error) {
        console.error(chalk.red(`Error: ${error}`));
        process.exit(1);
      } finally {
        await closeConnection();
      }
    }
  );

// Watch/monitor queues (non-interactive)
program
  .command("watch")
  .alias("w")
  .description("Monitor queues in real-time (non-interactive)")
  .option("-i, --interval <ms>", "Refresh interval in milliseconds", "2000")
  .action(async (options: { interval: string }) => {
    const opts = program.opts();
    const env = parseEnv(opts.env);
    try {
      const connection = await getConnection(env);
      await watchQueues(connection, {
        interval: parseInt(options.interval, 10),
      });
    } catch (error) {
      console.error(chalk.red(`Error: ${error}`));
      process.exit(1);
    } finally {
      await closeConnection();
    }
  });

// Interactive mode (default) - uses React Ink
program
  .command("interactive", { isDefault: true })
  .description("Interactive TUI mode for managing queues")
  .action(async () => {
    const opts = program.opts();
    const env = parseEnv(opts.env);

    try {
      const { waitUntilExit } = render(<Root initialEnv={env} />);
      await waitUntilExit();
    } catch (error) {
      console.error(chalk.red(`Error: ${error}`));
      process.exit(1);
    } finally {
      await closeConnection();
    }
  });

program.parse();
