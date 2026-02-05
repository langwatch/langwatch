#!/usr/bin/env node
/**
 * Analytics Parity Check
 *
 * Verifies that Elasticsearch and ClickHouse analytics backends return equivalent results.
 *
 * Configure via .env file, then run: pnpm start
 */

import { createRunPrefix, generateAllVariations } from "./otel-trace-generator.js";
import { setupDualExporterSDK } from "./sdk-trace-sender.js";
import { executeStructuredQueries, pollUntilTracesReady } from "./analytics-client.js";
import {
  compareAllResults,
  formatComparisonReport,
  formatDebugReport,
  generateSummary,
} from "./comparator.js";
import type { Config, VerificationReport } from "./types.js";

/**
 * Parse a numeric environment variable with validation and bounds checking.
 * Returns the default value if parsing fails, results in NaN, or is out of bounds.
 */
function parseNumericEnv(
  value: string | undefined,
  defaultValue: number,
  options?: { min?: number; max?: number; name?: string },
): number {
  if (!value) return defaultValue;

  const parsed = parseFloat(value);
  if (!Number.isFinite(parsed)) {
    console.warn(
      `Warning: Invalid ${options?.name ?? "env"}: "${value}", using default: ${defaultValue}`,
    );
    return defaultValue;
  }

  if (options?.min !== undefined && parsed < options.min) {
    console.warn(
      `Warning: ${options?.name ?? "env"} below minimum (${parsed} < ${options.min}), using default: ${defaultValue}`,
    );
    return defaultValue;
  }

  if (options?.max !== undefined && parsed > options.max) {
    console.warn(
      `Warning: ${options?.name ?? "env"} above maximum (${parsed} > ${options.max}), using default: ${defaultValue}`,
    );
    return defaultValue;
  }

  return parsed;
}

/**
 * Load configuration from environment variables
 */
function loadConfig(): Config {
  const config: Config = {
    baseUrl: process.env["BASE_URL"] ?? "http://localhost:3000",
    chApiKey: process.env["CH_API_KEY"] ?? "",
    chProjectId: process.env["CH_PROJECT_ID"] ?? "",
    esApiKey: process.env["ES_API_KEY"] ?? "",
    esProjectId: process.env["ES_PROJECT_ID"] ?? "",
    prodApiKey: process.env["PROD_API_KEY"] ?? null,
    tolerance: parseNumericEnv(process.env["TOLERANCE"], 0.05, {
      min: 0,
      max: 1,
      name: "TOLERANCE",
    }),
    traceCount: Math.floor(
      parseNumericEnv(process.env["TRACE_COUNT"], 20, {
        min: 1,
        name: "TRACE_COUNT",
      }),
    ),
    waitTimeMs: Math.floor(
      parseNumericEnv(process.env["WAIT_TIME_MS"], 120000, {
        min: 1000,
        name: "WAIT_TIME_MS",
      }),
    ), // 2 minutes default
  };

  // Validate required config
  const missing: string[] = [];
  if (!config.esProjectId) missing.push("ES_PROJECT_ID");
  if (!config.esApiKey) missing.push("ES_API_KEY");
  if (!config.chProjectId) missing.push("CH_PROJECT_ID");
  if (!config.chApiKey) missing.push("CH_API_KEY");

  if (missing.length > 0) {
    console.error("Error: Missing required environment variables:");
    missing.forEach((m) => console.error(`  - ${m}`));
    console.error("\nCopy .env.example to .env and fill in the values.");
    process.exit(1);
  }

  return config;
}

/**
 * Check if verbose mode is enabled via CLI flags
 */
function isVerboseMode(): boolean {
  return process.argv.includes("--verbose") || process.argv.includes("-v") || process.argv.includes("--debug");
}

/**
 * Main execution function
 */
async function main(): Promise<void> {
  const verbose = isVerboseMode();

  console.log("\n========================================");
  console.log("   ANALYTICS PARITY CHECK");
  console.log("========================================\n");

  if (verbose) {
    console.log("  [Verbose mode enabled]");
  }

  const config = loadConfig();

  console.log("Configuration:");
  console.log(`  Base URL: ${config.baseUrl}`);
  console.log(`  ES Project: ${config.esProjectId}`);
  console.log(`  CH Project: ${config.chProjectId}`);
  console.log(`  Tolerance: ${(config.tolerance * 100).toFixed(1)}%`);
  console.log(`  Traces per variation: ${config.traceCount}`);
  console.log(`  Wait time: ${config.waitTimeMs}ms`);

  const runPrefix = createRunPrefix();
  console.log(`\nRun ID: ${runPrefix}`);

  console.log("\n[1/4] Setting up dual-exporter SDK...");
  const { tracer, flush, shutdown } = await setupDualExporterSDK(
    config.baseUrl,
    config.esApiKey,
    config.chApiKey,
    config.prodApiKey,
  );

  console.log("\n[2/4] Generating and sending traces via OTEL SDK...");
  const { variations, totalTraces, timeRange } = await generateAllVariations(
    tracer,
    runPrefix,
    { tracesPerVariation: config.traceCount },
  );

  console.log(`\n  Generated ${variations.length} variations with ${totalTraces} total traces`);
  variations.forEach((v) => {
    console.log(`    - ${v.name}: ${v.count} traces`);
  });
  console.log(`  Time range: ${new Date(timeRange.startDate).toISOString()} to ${new Date(timeRange.endDate).toISOString()}`);

  console.log("\n  Flushing and shutting down SDK...");
  await flush();
  await shutdown();
  console.log("  Both ES and CH receive the same traces via dual exporters");

  console.log(`\n[3/4] Polling for trace ingestion (max wait: ${config.waitTimeMs}ms)...`);
  const pollResult = await pollUntilTracesReady(
    config.baseUrl,
    config.esApiKey,
    config.esProjectId,
    config.chApiKey,
    config.chProjectId,
    totalTraces,
    timeRange.startDate,
    timeRange.endDate,
    config.waitTimeMs,
  );

  if (pollResult.esError || pollResult.chError) {
    console.log("\n  Warning: Errors during polling:");
    if (pollResult.esError) console.log(`    ES: ${pollResult.esError.slice(0, 100)}`);
    if (pollResult.chError) console.log(`    CH: ${pollResult.chError.slice(0, 100)}`);
  }

  if (!pollResult.esReady || !pollResult.chReady) {
    console.log(`\n  Warning: Not all traces ingested. ES: ${pollResult.esCount}/${totalTraces}, CH: ${pollResult.chCount}/${totalTraces}`);
  }

  console.log("\n  Waiting 30 seconds for analytics indexing...");
  await new Promise((resolve) => setTimeout(resolve, 30000));

  console.log("\n[4/4] Querying analytics from both projects...");

  console.log("\nQuerying ES project...");
  const esResults = await executeStructuredQueries(
    config.baseUrl,
    config.esApiKey,
    config.esProjectId,
    timeRange.startDate,
    timeRange.endDate,
  );

  if (esResults.failedQueries > 0) {
    console.log(`  Warning: ${esResults.failedQueries}/${esResults.totalQueries} queries failed`);
  }

  console.log("\nQuerying CH project...");
  const chResults = await executeStructuredQueries(
    config.baseUrl,
    config.chApiKey,
    config.chProjectId,
    timeRange.startDate,
    timeRange.endDate,
  );

  if (chResults.failedQueries > 0) {
    console.log(`  Warning: ${chResults.failedQueries}/${chResults.totalQueries} queries failed`);
  }

  // Early exit if all queries failed
  if (esResults.successfulQueries === 0 || chResults.successfulQueries === 0) {
    console.error("\nERROR: All analytics queries failed!");
    if (esResults.successfulQueries === 0) {
      console.error("  ES: All queries failed - check API key permissions");
    }
    if (chResults.successfulQueries === 0) {
      console.error("  CH: All queries failed - check API key permissions");
    }
    process.exit(1);
  }

  console.log("\nComparing results...");
  const comparisons = compareAllResults(esResults, chResults, config.tolerance);
  const summary = generateSummary(comparisons);

  const report: VerificationReport = {
    timestamp: new Date().toISOString(),
    runId: runPrefix,
    tracesGenerated: totalTraces,
    tracesSent: {
      es: totalTraces,
      ch: totalTraces,
    },
    comparisons,
    overallPassed: summary.overallPassed,
    summary,
  };

  // Add debug information to report when verbose mode is enabled
  if (verbose) {
    report.debug = {
      esQueries: esResults.queries.map((q) => ({
        name: q.name,
        type: q.type,
        input: q.input,
        result: q.result,
        rawResponse: q.rawResponse,
        error: q.error,
      })),
      chQueries: chResults.queries.map((q) => ({
        name: q.name,
        type: q.type,
        input: q.input,
        result: q.result,
        rawResponse: q.rawResponse,
        error: q.error,
      })),
    };
  }

  console.log(formatComparisonReport(comparisons));

  // Show debug report for failed queries when verbose
  if (verbose && !summary.overallPassed) {
    console.log(formatDebugReport(comparisons, esResults, chResults));
  }

  const reportPath = `parity-report-${runPrefix}.json`;
  const fs = await import("node:fs/promises");
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
  console.log(`\nFull report saved to: ${reportPath}`);

  if (verbose) {
    console.log(`\n  [Verbose mode: Full query details included in JSON report]`);
  }

  process.exit(summary.overallPassed ? 0 : 1);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
