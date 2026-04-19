#!/usr/bin/env node

import "dotenv/config";

// Suppress the singleton Redis connection in redis.ts — the migration manages its own.
process.env.SKIP_REDIS ??= "true";
process.env.SKIP_ENV_VALIDATION ??= "true";

// Silence event-sourcing pino internals — the migration has its own logging.
process.env.PINO_CONSOLE_LEVEL = "warn";
process.env.PINO_LOG_LEVEL = "warn";

// Disable LangWatch/OTEL tracing — prevent migration from sending traces to itself.
process.env.OTEL_SDK_DISABLED = "true";
delete process.env.LANGWATCH_API_KEY;

type MigrationTarget = "simulations" | "batch-evaluations" | "dspy-steps" | "traces" | "trace-evaluations" | "traces-cold" | "trace-evaluations-cold" | "traces-combined" | "traces-combined-cold" | "all";

interface CliOptions {
  target: MigrationTarget;
  dryRun: boolean;
  singleBatch: boolean;
}

function parseArgs(): CliOptions {
  const args = process.argv.slice(2);
  let target: MigrationTarget = "all";
  let dryRun = false;
  let singleBatch = false;

  const validTargets: MigrationTarget[] = ["simulations", "batch-evaluations", "dspy-steps", "traces", "trace-evaluations", "traces-cold", "trace-evaluations-cold", "traces-combined", "traces-combined-cold", "all"];

  for (const arg of args) {
    if (arg === "--dry-run" || arg === "-n") {
      dryRun = true;
    } else if (arg === "--single-batch" || arg === "-1") {
      singleBatch = true;
    } else if (arg === "--help" || arg === "-h") {
      printUsage();
      process.exit(0);
    } else if (arg.startsWith("-")) {
      process.stderr.write(`Unknown flag: ${arg}\n\n`);
      printUsage();
      process.exit(1);
    } else if (validTargets.includes(arg.toLowerCase() as MigrationTarget)) {
      target = arg.toLowerCase() as MigrationTarget;
    } else {
      process.stderr.write(`Unknown argument: ${arg}\n\n`);
      printUsage();
      process.exit(1);
    }
  }

  return { target, dryRun, singleBatch };
}

function printUsage(): void {
  process.stderr.write(
    `Usage: es-migration [target] [options]\n` +
      `\n` +
      `Targets:\n` +
      `  simulations             Migrate simulation events only\n` +
      `  batch-evaluations       Migrate batch evaluation data only\n` +
      `  dspy-steps              Migrate DSPy optimization steps only\n` +
      `  traces                  Migrate traces (hot storage)\n` +
      `  trace-evaluations       Migrate trace evaluations (hot storage)\n` +
      `  traces-cold             Migrate traces from cold storage\n` +
      `  trace-evaluations-cold  Migrate trace evaluations from cold storage\n` +
      `  traces-combined         Migrate traces + evaluations in single pass (hot)\n` +
      `  traces-combined-cold    Migrate traces + evaluations in single pass (cold)\n` +
      `  all                     Migrate everything including cold storage (default)\n` +
      `\n` +
      `Options:\n` +
      `  --dry-run, -n       Read ES and check CH, but don't write anything\n` +
      `  --single-batch, -1  Process one batch then stop (good for testing)\n` +
      `  --help, -h          Show this help\n` +
      `\n` +
      `Environment variables:\n` +
      `  ELASTICSEARCH_NODE_URL   ES connection URL (required)\n` +
      `  ELASTICSEARCH_API_KEY    ES API key (optional)\n` +
      `  CLICKHOUSE_URL           ClickHouse connection URL (required)\n` +
      `  BATCH_SIZE               Events per ES fetch (default: 1000)\n` +
      `  CONCURRENCY              Parallel aggregates per batch (default: 50)\n` +
      `  MAX_EVENTS               Stop after N events (default: unlimited)\n` +
      `  MAX_BATCHES              Stop after N batches (default: unlimited)\n` +
      `  DRY_RUN                  Same as --dry-run flag (default: false)\n` +
      `  DRY_RUN_OUTPUT           Custom dry-run JSON output file path\n` +
      `  CH_BATCH_SIZE            ClickHouse insert buffer size (default: 500, recommend 5000 for migration)\n` +
      `  BATCH_DELAY_MS           Delay between batches in ms (default: 0)\n` +
      `  DISCOVERY_WINDOW_MS      Time window for discovery mode in ms (default: 3600000)\n` +
      `  CURSOR_FILE              Custom cursor file path\n` +
      `  LOG_LEVEL                debug|info|warn|error (default: info)\n` +
      `  ES_PORT_FORWARD          Enable kubectl port-forward for ES (default: false)\n` +
      `\n` +
      `Examples:\n` +
      `  # Preview what would be migrated (read-only)\n` +
      `  es-migration simulations --dry-run\n` +
      `\n` +
      `  # Process one batch of simulations to verify\n` +
      `  es-migration simulations --single-batch\n` +
      `\n` +
      `  # Dry-run a single batch (safest test)\n` +
      `  es-migration batch-evaluations --dry-run --single-batch\n` +
      `\n` +
      `  # Migrate traces with dry-run\n` +
      `  es-migration traces --dry-run --single-batch\n` +
      `\n` +
      `  # Migrate trace evaluations\n` +
      `  es-migration trace-evaluations --single-batch\n` +
      `\n` +
      `  # Full migration\n` +
      `  es-migration all\n`,
  );
}

function printPreflightStats(preflightStats: { totalEvents: number; minTimestamp: number; maxTimestamp: number }): void {
  const minDate = preflightStats.minTimestamp
    ? new Date(preflightStats.minTimestamp).toISOString()
    : "N/A";
  const maxDate = preflightStats.maxTimestamp
    ? new Date(preflightStats.maxTimestamp).toISOString()
    : "N/A";
  process.stderr.write(`  Scope:\n`);
  process.stderr.write(
    `    Events remaining: ${preflightStats.totalEvents.toLocaleString()}\n`,
  );
  process.stderr.write(`    Date range:       ${minDate} → ${maxDate}\n\n`);
}

async function main(): Promise<void> {
  const cli = parseArgs();

  // Dynamic imports so SKIP_REDIS is set before any EventSourcing modules load
  const { createApp } = await import("./app.js");
  const { EsScanner } = await import("./lib/esScanner.js");
  const { ExistenceChecker } = await import("./lib/existenceChecker.js");
  const { FileCursorStore } = await import("./lib/cursorStore.js");
  const { Migrator } = await import("./lib/migrator.js");
  const { DiscoveryMigrator } = await import("./lib/discoveryMigrator.js");
  const { createSimulationMigrationDefinition } = await import(
    "./migrations/simulations/definition.js"
  );
  const { createEvaluationMigrationDefinition } = await import(
    "./migrations/batch-evaluations/definition.js"
  );
  const { createTraceMigrationDefinition } = await import(
    "./migrations/traces/definition.js"
  );
  const { createTraceEvaluationMigrationDefinition } = await import(
    "./migrations/trace-evaluations/definition.js"
  );
  const { createCombinedTraceMigrationDefinition } = await import(
    "./migrations/traces-combined/definition.js"
  );
  const { createDspyStepMigrationDefinition } = await import(
    "./migrations/dspy-steps/definition.js"
  );

  // Build config with CLI overrides
  const configOverrides: Record<string, unknown> = {};
  if (cli.dryRun) configOverrides.dryRun = true;
  if (cli.singleBatch) configOverrides.maxBatches = 1;

  // Default dry-run output files per target (overridable via DRY_RUN_OUTPUT env)
  const allTargets: Exclude<MigrationTarget, "all">[] = [
    "simulations", "batch-evaluations", "dspy-steps", "traces-combined", "traces-combined-cold",
  ];
  const dryRunOutputFiles: Record<string, string> = {};
  if (cli.dryRun && !process.env.DRY_RUN_OUTPUT) {
    for (const t of cli.target === "all" ? allTargets : [cli.target]) {
      dryRunOutputFiles[t] = `./dry-run-${t}.json`;
    }
  }

  process.stderr.write("\n========================================\n");
  process.stderr.write("  ES → ClickHouse Migration\n");
  process.stderr.write("========================================\n\n");

  const app = await createApp(configOverrides);
  const { config, logger } = app;

  const modeLabel = config.dryRun
    ? "DRY RUN"
    : config.maxBatches === 1
      ? "SINGLE BATCH"
      : "LIVE";
  process.stderr.write(`  Mode:        ${modeLabel}\n`);
  process.stderr.write(`  Batch size:  ${config.batchSize}\n`);
  process.stderr.write(`  Concurrency: ${config.concurrency}\n`);
  if (config.delayBetweenBatchesMs > 0) {
    process.stderr.write(`  Delay:       ${config.delayBetweenBatchesMs}ms\n`);
  }
  if (config.maxEvents) {
    process.stderr.write(`  Max events:  ${config.maxEvents}\n`);
  }
  if (config.maxBatches) {
    process.stderr.write(`  Max batches: ${config.maxBatches}\n`);
  }
  process.stderr.write(`  Target:      ${cli.target}\n`);
  if (Object.keys(dryRunOutputFiles).length > 0) {
    for (const [t, f] of Object.entries(dryRunOutputFiles)) {
      process.stderr.write(`  Output:      ${f} (${t})\n`);
    }
  } else if (config.dryRunOutputFile) {
    process.stderr.write(`  Output:      ${config.dryRunOutputFile}\n`);
  }
  process.stderr.write(`\n`);

  const targets: MigrationTarget[] =
    cli.target === "all" ? allTargets : [cli.target];

  let hasErrors = false;

  try {
    for (const target of targets) {
      process.stderr.write(`\n--- ${target.toUpperCase()} ---\n\n`);

      const cursorFile =
        process.env.CURSOR_FILE ?? `./cursor-${target}.json`;
      const cursorStore = new FileCursorStore(cursorFile);

      // Set per-target dry-run output file
      const targetConfig = dryRunOutputFiles[target]
        ? { ...config, dryRunOutputFile: dryRunOutputFiles[target] }
        : config;

      let stats: { total: number; dispatched: number; duplicates: number; skipped: number; errors: number };

      if (target === "simulations") {
        // Discovery-based migration for simulations
        const definition = createSimulationMigrationDefinition({
          simulationRunStore: app.simulationRunStore,
        });

        const scanner = new EsScanner(app.esClient, config, logger, {
          index: definition.esIndex,
          sort: definition.esSort,
          query: definition.esQuery,
          timestampField: definition.timestampField,
          statsField: definition.statsField,
          aggregateIdField: definition.aggregateIdField,
        });

        const existenceChecker = new ExistenceChecker(
          app.clickhouse,
          definition.aggregateType,
        );

        // Pre-flight stats
        const cursor = await cursorStore.load();
        const preflightStats = await scanner.getStats(cursor);
        printPreflightStats(preflightStats);

        if (preflightStats.totalEvents === 0) {
          process.stderr.write(`  Nothing to migrate.\n`);
          continue;
        }

        const windowSizeMs = parseInt(
          process.env.DISCOVERY_WINDOW_MS ?? String(60 * 60 * 1000 * 2),
          10,
        );

        const migrator = new DiscoveryMigrator({
          scanner,
          existenceChecker,
          cursorStore,
          clickhouse: app.clickhouse,
          config: targetConfig,
          logger,
          definition,
          flushClickHouse: app.flushClickHouse,
          insertEventRecords: app.insertEventRecords,
          windowSizeMs,
        });

        stats = await migrator.run({ preflightStats });
      } else {
        // Standard stream-based migration for other targets
        const COLD_INDEX = "search-traces-cold-alias";

        const definition = (() => {
          switch (target) {
            case "batch-evaluations":
              return createEvaluationMigrationDefinition({
                experimentRunStateFoldStore: app.experimentRunStateFoldStore,
                experimentRunItemAppendStore: app.experimentRunItemAppendStore,
              });
            case "dspy-steps":
              return createDspyStepMigrationDefinition({
                dspyStepRepository: app.dspyStepRepository,
              });
            case "traces":
              return createTraceMigrationDefinition({
                traceSummaryStore: app.traceSummaryStore,
                spanAppendStore: app.spanAppendStore,
              });
            case "traces-cold":
              return {
                ...createTraceMigrationDefinition({
                  traceSummaryStore: app.traceSummaryStore,
                  spanAppendStore: app.spanAppendStore,
                }),
                esIndex: COLD_INDEX,
              };
            case "trace-evaluations":
              return createTraceEvaluationMigrationDefinition({
                evaluationRunStore: app.evaluationRunStore,
              });
            case "trace-evaluations-cold":
              return {
                ...createTraceEvaluationMigrationDefinition({
                  evaluationRunStore: app.evaluationRunStore,
                }),
                esIndex: COLD_INDEX,
              };
            case "traces-combined":
              return createCombinedTraceMigrationDefinition({
                traceSummaryStore: app.traceSummaryStore,
                spanAppendStore: app.spanAppendStore,
                evaluationRunStore: app.evaluationRunStore,
              });
            case "traces-combined-cold":
              return {
                ...createCombinedTraceMigrationDefinition({
                  traceSummaryStore: app.traceSummaryStore,
                  spanAppendStore: app.spanAppendStore,
                  evaluationRunStore: app.evaluationRunStore,
                }),
                esIndex: COLD_INDEX,
              };
            default:
              throw new Error(`Unknown target: ${target}`);
          }
        })();

        const service =
          target === "batch-evaluations"
            ? app.evaluationService
            : app.simulationService; // traces/trace-evaluations/cold variants use direct-write, service not used

        const scanner = new EsScanner(app.esClient, config, logger, {
          index: definition.esIndex,
          sort: definition.esSort,
          query: definition.esQuery,
          timestampField: definition.timestampField,
          statsField: definition.statsField,
        });

        const existenceChecker = new ExistenceChecker(
          app.clickhouse,
          definition.aggregateType,
        );

        // Pre-flight stats
        const cursor = await cursorStore.load();
        const preflightStats = await scanner.getStats(cursor);
        printPreflightStats(preflightStats);

        if (preflightStats.totalEvents === 0) {
          process.stderr.write(`  Nothing to migrate.\n`);
          continue;
        }

        const migrator = new Migrator({
          scanner,
          existenceChecker,
          cursorStore,
          clickhouse: app.clickhouse,
          config: targetConfig,
          logger,
          service: service as any,
          definition,
          flushClickHouse: app.flushClickHouse,
          insertEventRecords: app.insertEventRecords,
        });

        stats = await migrator.run({ preflightStats });
      }

      const dispLabel = config.dryRun ? "Would dispatch" : "Dispatched";
      process.stderr.write(
        `\n  ${target.toUpperCase()} Results${config.dryRun ? " (DRY RUN)" : ""}:\n`,
      );
      process.stderr.write(`    Total events:   ${stats.total}\n`);
      process.stderr.write(
        `    ${dispLabel}:${" ".repeat(14 - dispLabel.length)}${stats.dispatched}\n`,
      );
      process.stderr.write(`    Duplicates:     ${stats.duplicates}\n`);
      process.stderr.write(`    Skipped:        ${stats.skipped}\n`);
      process.stderr.write(`    Errors:         ${stats.errors}\n`);

      if (stats.errors > 0) hasErrors = true;
    }

    process.stderr.write("\n========================================\n");
    process.stderr.write("  Migration complete\n");
    process.stderr.write("========================================\n\n");

    process.exitCode = hasErrors ? 1 : 0;
  } finally {
    await app.close();
  }
}

main()
  .then(() => {
    // Force exit after main() resolves. Some handle in the event-sourcing
    // runtime or the ClickHouse keep-alive pool keeps the event loop alive
    // even after app.close() finishes, so the process would otherwise hang
    // forever in CI (and had to be killed by hand locally).
    process.exit(process.exitCode ?? 0);
  })
  .catch((err) => {
    process.stderr.write(`Fatal error: ${err}\n`);
    process.exit(2);
  });
