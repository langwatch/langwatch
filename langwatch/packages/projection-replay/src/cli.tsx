#!/usr/bin/env node
import "./env-defaults";
import dotenv from "dotenv";

// Load this package's .env with override so it wins over the cleared defaults
dotenv.config({ override: true });

import { Command } from "commander";
import IORedis from "ioredis";
import { render } from "ink";
import React from "react";
import { createClickHouseClient } from "./clickhouse";
import {
  discoverAllFoldProjections,
  type DiscoveredFoldProjection,
} from "./discovery";
import { cleanupAll } from "./markers";
import { ReplayUI } from "./components/ReplayUI";
import { ParallelReplayUI } from "./components/ParallelReplayUI";
import { ReplayWizard, type ReplayConfig } from "./components/ReplayWizard";

function resolveClickHouseUrl(opts: { clickhouseUrl?: string }): string {
  const url = opts.clickhouseUrl ?? process.env.CLICKHOUSE_URL;
  if (!url) {
    console.error(
      "ClickHouse URL is required. Pass --clickhouse-url or set CLICKHOUSE_URL.",
    );
    process.exit(1);
  }
  return url;
}

function resolveRedisUrl(opts: { redisUrl?: string }): string {
  const url = opts.redisUrl ?? process.env.REDIS_URL;
  if (!url) {
    console.error("Redis URL is required. Pass --redis-url or set REDIS_URL.");
    process.exit(1);
  }
  return url;
}

function resolveDatabaseUrl(opts: { databaseUrl?: string }): string {
  const url = opts.databaseUrl || process.env.DATABASE_URL || "";
  if (!url) {
    console.error(
      "Database URL is required. Pass --database-url or set DATABASE_URL in packages/projection-replay/.env.",
    );
    process.exit(1);
  }
  process.env.DATABASE_URL = url;
  return url;
}

async function fetchProject(
  tenantId: string,
): Promise<{ name: string; slug: string } | null> {
  const { prisma } = await import("~/server/db");
  const project = await prisma.project.findUnique({
    where: { id: tenantId },
    select: { name: true, slug: true },
  });
  return project;
}

async function resolveProjections(
  names: string,
): Promise<DiscoveredFoldProjection[]> {
  const all = await discoverAllFoldProjections();
  const requested = names.split(",").map((n) => n.trim());
  const resolved: DiscoveredFoldProjection[] = [];
  const missing: string[] = [];

  for (const name of requested) {
    const found = all.find((p) => p.projectionName === name);
    if (found) {
      resolved.push(found);
    } else {
      missing.push(name);
    }
  }

  if (missing.length > 0) {
    const available = all.map((p) => p.projectionName).join(", ");
    console.error(
      `Projection(s) not found: ${missing.join(", ")}\nAvailable: ${available || "none"}`,
    );
    process.exit(1);
  }

  return resolved;
}

function runWizard(props: {
  tenantId: string;
  projectInfo: { name: string; slug: string } | null;
  availableProjections: DiscoveredFoldProjection[];
  initialProjections?: DiscoveredFoldProjection[];
  initialSince?: string;
  initialConcurrency?: number;
  initialDryRun?: boolean;
}): Promise<ReplayConfig | null> {
  return new Promise((resolve) => {
    const { unmount } = render(
      <ReplayWizard
        tenantId={props.tenantId}
        projectInfo={props.projectInfo}
        availableProjections={props.availableProjections}
        initialProjections={props.initialProjections}
        initialSince={props.initialSince}
        initialConcurrency={props.initialConcurrency}
        initialDryRun={props.initialDryRun}
        onComplete={(config) => {
          unmount();
          resolve(config);
        }}
        onCancel={() => {
          unmount();
          resolve(null);
        }}
      />,
    );
  });
}

function runProjectionPicker(props: {
  tenantId: string;
  projectInfo: { name: string; slug: string } | null;
  availableProjections: DiscoveredFoldProjection[];
}): Promise<DiscoveredFoldProjection[] | null> {
  return new Promise((resolve) => {
    const { unmount } = render(
      <ReplayWizard
        tenantId={props.tenantId}
        projectInfo={props.projectInfo}
        availableProjections={props.availableProjections}
        initialSince="unused"
        initialConcurrency={1}
        initialDryRun={false}
        onComplete={(config) => {
          unmount();
          resolve(config.projections);
        }}
        onCancel={() => {
          unmount();
          resolve(null);
        }}
      />,
    );
  });
}

async function main() {
  const program = new Command();
  program
    .name("projection-replay")
    .description("Replay historical events through fold projections");

  program
    .command("replay")
    .option(
      "--projection <name>",
      "Projection name(s), comma-separated (interactive if omitted)",
    )
    .requiredOption(
      "--tenant-id <id>",
      "Tenant ID to replay (e.g. project_abc123)",
    )
    .option(
      "--since <date>",
      "Discover aggregates with events from this date (YYYY-MM-DD)",
    )
    .option(
      "--clickhouse-url <url>",
      "ClickHouse connection URL (or set CLICKHOUSE_URL env var)",
    )
    .option(
      "--redis-url <url>",
      "Redis connection URL (or set REDIS_URL env var)",
    )
    .option(
      "--database-url <url>",
      "Database connection URL (or set DATABASE_URL env var)",
    )
    .option("--batch-size <number>", "Events per ClickHouse page", "5000")
    .option("--aggregate-batch-size <number>", "Aggregates per batch", "1000")
    .option(
      "--concurrency <number>",
      "Parallel aggregate replays per batch",
      "10",
    )
    .option("--dry-run", "Discover and count without replaying", false)
    .action(
      async (opts: {
        projection?: string;
        tenantId: string;
        since?: string;
        clickhouseUrl?: string;
        redisUrl?: string;
        databaseUrl?: string;
        batchSize: string;
        aggregateBatchSize: string;
        concurrency: string;
        dryRun: boolean;
      }) => {
        resolveDatabaseUrl(opts);
        const projectInfo = await fetchProject(opts.tenantId);

        const needsWizard = !opts.projection || !opts.since;

        let projections: DiscoveredFoldProjection[];
        let since: string;
        let concurrency: number;
        let dryRun: boolean;

        if (needsWizard) {
          const allProjections = await discoverAllFoldProjections();

          // Pre-resolve projections from CLI if provided
          let initialProjections: DiscoveredFoldProjection[] | undefined;
          if (opts.projection) {
            initialProjections = await resolveProjections(opts.projection);
          }

          const initialConcurrency = parseInt(opts.concurrency, 10);

          const config = await runWizard({
            tenantId: opts.tenantId,
            projectInfo: projectInfo,
            availableProjections: allProjections,
            initialProjections,
            initialSince: opts.since,
            initialConcurrency: isNaN(initialConcurrency)
              ? undefined
              : initialConcurrency,
            initialDryRun: undefined,
          });

          if (!config) {
            console.log("Cancelled.");
            return;
          }

          projections = config.projections;
          since = config.since;
          concurrency = config.concurrency;
          dryRun = config.dryRun;
        } else {
          // Both opts.projection and opts.since are guaranteed defined here
          // (needsWizard = !opts.projection || !opts.since was false)
          projections = await resolveProjections(opts.projection!);
          since = opts.since!;

          const parsedConcurrency = parseInt(opts.concurrency, 10);
          if (isNaN(parsedConcurrency) || parsedConcurrency < 1) {
            console.error("--concurrency must be a positive integer.");
            process.exit(1);
          }
          concurrency = parsedConcurrency;
          dryRun = opts.dryRun;
        }

        const chUrl = resolveClickHouseUrl(opts);
        const rUrl = resolveRedisUrl(opts);

        const redis = new IORedis(rUrl, { maxRetriesPerRequest: null });
        const client = createClickHouseClient(chUrl);

        const batchSize = parseInt(opts.batchSize, 10);
        if (isNaN(batchSize) || batchSize < 1) {
          console.error("--batch-size must be a positive integer.");
          process.exit(1);
        }

        const aggregateBatchSize = parseInt(opts.aggregateBatchSize, 10);
        if (isNaN(aggregateBatchSize) || aggregateBatchSize < 1) {
          console.error("--aggregate-batch-size must be a positive integer.");
          process.exit(1);
        }

        if (projections.length === 1) {
          const { waitUntilExit } = render(
            <ReplayUI
              projection={projections[0]!}
              tenantId={opts.tenantId}
              projectInfo={projectInfo}
              since={since}
              batchSize={batchSize}
              aggregateBatchSize={aggregateBatchSize}
              concurrency={concurrency}
              dryRun={dryRun}
              client={client}
              redis={redis}
            />,
          );
          await waitUntilExit();
        } else {
          const { waitUntilExit } = render(
            <ParallelReplayUI
              projections={projections}
              tenantId={opts.tenantId}
              projectInfo={projectInfo}
              since={since}
              batchSize={batchSize}
              aggregateBatchSize={aggregateBatchSize}
              concurrency={concurrency}
              dryRun={dryRun}
              client={client}
              redis={redis}
            />,
          );
          await waitUntilExit();
        }

        await client.close();
        redis.disconnect();
      },
    );

  program
    .command("cleanup")
    .option(
      "--projection <name>",
      "Projection name(s), comma-separated (interactive if omitted)",
    )
    .requiredOption(
      "--tenant-id <id>",
      "Tenant ID (required for project lookup in interactive mode)",
    )
    .option(
      "--redis-url <url>",
      "Redis connection URL (or set REDIS_URL env var)",
    )
    .option(
      "--database-url <url>",
      "Database connection URL (or set DATABASE_URL env var)",
    )
    .action(
      async (opts: {
        projection?: string;
        tenantId: string;
        redisUrl?: string;
        databaseUrl?: string;
      }) => {
        const rUrl = resolveRedisUrl(opts);
        const redis = new IORedis(rUrl, { maxRetriesPerRequest: null });

        let projectionNames: string[];

        if (opts.projection) {
          projectionNames = opts.projection.split(",").map((n) => n.trim());
        } else {
          resolveDatabaseUrl(opts);
          const allProjections = await discoverAllFoldProjections();
          const projectInfo = await fetchProject(opts.tenantId);

          const selected = await runProjectionPicker({
            tenantId: opts.tenantId,
            projectInfo,
            availableProjections: allProjections,
          });

          if (!selected) {
            console.log("Cancelled.");
            redis.disconnect();
            return;
          }

          projectionNames = selected.map((p) => p.projectionName);
        }

        for (const name of projectionNames) {
          await cleanupAll({ redis, projectionName: name });
          console.log(`Cleaned up all markers for projection "${name}".`);
        }

        redis.disconnect();
      },
    );

  program
    .command("list")
    .description("List all discovered fold projections")
    .action(async () => {
      const all = await discoverAllFoldProjections();
      if (all.length === 0) {
        console.log("No fold projections found.");
        return;
      }

      console.log();
      console.log("  Fold Projections");
      console.log("  " + "\u2500".repeat(60));
      console.log();

      for (const p of all) {
        const source = p.source === "global" ? "global" : p.pipelineName;
        console.log(
          `  \x1b[1m${p.projectionName}\x1b[0m  \x1b[2m(${source})\x1b[0m`,
        );
        console.log(`  events:  ${p.definition.eventTypes.join(", ")}`);
        console.log(`  queue:   ${p.queueName}`);
        console.log();
      }

      console.log(`  ${all.length} projection(s) found`);
      console.log();
    });

  // Strip leading '--' that pnpm injects between script path and args
  const argv = [...process.argv];
  if (argv[2] === "--") argv.splice(2, 1);
  await program.parseAsync(argv);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Fatal error:", error);
    process.exit(1);
  });
