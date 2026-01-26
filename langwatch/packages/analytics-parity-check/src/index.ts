#!/usr/bin/env node
/**
 * Analytics Parity Check
 *
 * Verifies that Elasticsearch and ClickHouse analytics backends return equivalent results.
 *
 * Configure via .env file, then run: pnpm start
 */

import {
  createRunPrefix,
  generateTestVariations,
  getTotalTraceCount,
  getTimeRange,
} from "./trace-generator.js";
import { sendVariationsToProjects } from "./collector-client.js";
import { executeStructuredQueries } from "./analytics-client.js";
import {
  compareAllResults,
  formatComparisonReport,
  generateSummary,
} from "./comparator.js";
import type { Config, VerificationReport } from "./types.js";

/**
 * Load configuration from environment variables
 */
function loadConfig(): Config {
  const config: Config = {
    baseUrl: process.env["BASE_URL"] ?? "http://localhost:3000",
    esProjectId: process.env["ES_PROJECT_ID"] ?? "",
    esApiKey: process.env["ES_API_KEY"] ?? "",
    chProjectId: process.env["CH_PROJECT_ID"] ?? "",
    chApiKey: process.env["CH_API_KEY"] ?? "",
    tolerance: parseFloat(process.env["TOLERANCE"] ?? "0.05"),
    traceCount: parseInt(process.env["TRACE_COUNT"] ?? "20", 10),
    waitTimeMs: parseInt(process.env["WAIT_TIME_MS"] ?? "10000", 10),
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
 * Main execution function
 */
async function main(): Promise<void> {
  console.log("\n========================================");
  console.log("   ANALYTICS PARITY CHECK");
  console.log("========================================\n");

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

  console.log("\n[1/4] Generating test traces...");
  const variations = generateTestVariations(runPrefix, config.traceCount);
  const totalTraces = getTotalTraceCount(variations);
  const timeRange = getTimeRange(variations);

  console.log(`  Generated ${variations.length} variations with ${totalTraces} total traces`);
  variations.forEach((v) => {
    console.log(`    - ${v.name}: ${v.traces.length} traces`);
  });
  console.log(`  Time range: ${new Date(timeRange.startDate).toISOString()} to ${new Date(timeRange.endDate).toISOString()}`);

  console.log("\n[2/4] Sending traces to both projects...");
  const sendResults = await sendVariationsToProjects(
    config.baseUrl,
    config.esApiKey,
    config.chApiKey,
    variations,
    (project, sent, total) => {
      process.stdout.write(`\r  ${project}: ${sent}/${total} traces sent`);
    },
  );

  console.log("\n");
  console.log(`  ES: ${sendResults.es.success} succeeded, ${sendResults.es.failed} failed`);
  console.log(`  CH: ${sendResults.ch.success} succeeded, ${sendResults.ch.failed} failed`);

  if (sendResults.es.errors.length > 0) {
    console.log("  ES Errors:");
    sendResults.es.errors.slice(0, 5).forEach((e) => console.log(`    - ${e}`));
  }
  if (sendResults.ch.errors.length > 0) {
    console.log("  CH Errors:");
    sendResults.ch.errors.slice(0, 5).forEach((e) => console.log(`    - ${e}`));
  }

  console.log(`\n[3/4] Waiting ${config.waitTimeMs}ms for ingestion...`);
  await sleep(config.waitTimeMs);

  console.log("\n[4/4] Querying analytics from both projects...");

  console.log("\nQuerying ES project...");
  const esResults = await executeStructuredQueries(
    config.baseUrl,
    config.esApiKey,
    config.esProjectId,
    timeRange.startDate,
    timeRange.endDate,
  );

  console.log("\nQuerying CH project...");
  const chResults = await executeStructuredQueries(
    config.baseUrl,
    config.chApiKey,
    config.chProjectId,
    timeRange.startDate,
    timeRange.endDate,
  );

  console.log("\nComparing results...");
  const comparisons = compareAllResults(esResults, chResults, config.tolerance);
  const summary = generateSummary(comparisons);

  const report: VerificationReport = {
    timestamp: new Date().toISOString(),
    runId: runPrefix,
    tracesGenerated: totalTraces,
    tracesSent: {
      es: sendResults.es.success,
      ch: sendResults.ch.success,
    },
    comparisons,
    overallPassed: summary.overallPassed,
    summary,
  };

  console.log(formatComparisonReport(comparisons));

  const reportPath = `parity-report-${runPrefix}.json`;
  const fs = await import("node:fs/promises");
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
  console.log(`\nFull report saved to: ${reportPath}`);

  process.exit(summary.overallPassed ? 0 : 1);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
