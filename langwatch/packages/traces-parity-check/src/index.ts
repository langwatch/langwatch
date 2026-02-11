#!/usr/bin/env node
/**
 * Traces Parity Check - CLI Entry Point
 *
 * Verifies that individual trace data — input/output, metrics, metadata, spans —
 * is properly stored and retrieved from both ES and CH backends.
 */

import { loadConfig, isVerboseMode } from "./config.js";
import { runParityPipeline } from "./pipeline.js";

async function main(): Promise<void> {
  console.log("\n========================================");
  console.log("   TRACES PARITY CHECK");
  console.log("========================================\n");

  const verbose = isVerboseMode();
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
  console.log(`  Python examples: ${config.runPythonExamples ? "enabled" : "disabled"}`);
  console.log(`  Onboarding snippets: ${config.runSnippets ? "enabled" : "disabled"}`);

  const { report, overallPassed } = await runParityPipeline(config, verbose);

  // Save JSON report
  const reportPath = `parity-report-${report.runId}.json`;
  const fs = await import("node:fs/promises");
  await fs.writeFile(reportPath, JSON.stringify(report, null, 2));
  console.log(`Full report saved to: ${reportPath}`);

  process.exit(overallPassed ? 0 : 1);
}

main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
