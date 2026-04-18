import type { ExperimentRunResult } from "./platformTypes";

/**
 * Print a CI-friendly summary of experiment results to stdout.
 *
 * Shared between platform runs (`langwatch.experiments.run`) and SDK-driven
 * experiments (`langwatch.experiments.init` → `experiment.printSummary()`).
 */
export function printSummary(result: Omit<ExperimentRunResult, "printSummary" | "toString">): void {
  const { runId, status, passed, failed, passRate, duration, runUrl, summary } = result;

  console.log("\n" + "═".repeat(60));
  console.log("  EXPERIMENT RESULTS");
  console.log("═".repeat(60));
  console.log(`  Run ID:     ${runId}`);
  console.log(`  Status:     ${status.toUpperCase()}`);
  console.log(`  Duration:   ${(duration / 1000).toFixed(1)}s`);
  console.log("─".repeat(60));
  console.log(`  Passed:     ${passed}`);
  console.log(`  Failed:     ${failed}`);
  console.log(`  Pass Rate:  ${passRate.toFixed(1)}%`);

  if (summary.targets && summary.targets.length > 0) {
    console.log("─".repeat(60));
    console.log("  TARGETS:");
    for (const target of summary.targets) {
      console.log(`    ${target.name}: ${target.passed} passed, ${target.failed} failed`);
      if (target.avgLatency) {
        console.log(`      Avg latency: ${target.avgLatency.toFixed(0)}ms`);
      }
      if (target.totalCost) {
        console.log(`      Total cost: $${target.totalCost.toFixed(4)}`);
      }
    }
  }

  if (summary.evaluators && summary.evaluators.length > 0) {
    console.log("─".repeat(60));
    console.log("  EVALUATORS:");
    for (const evaluator of summary.evaluators) {
      console.log(`    ${evaluator.name}: ${evaluator.passRate.toFixed(1)}% pass rate`);
      if (evaluator.avgScore !== undefined) {
        console.log(`      Avg score: ${evaluator.avgScore.toFixed(2)}`);
      }
    }
  }

  console.log("─".repeat(60));
  console.log(`  View details: ${runUrl}`);
  console.log("═".repeat(60) + "\n");
}
