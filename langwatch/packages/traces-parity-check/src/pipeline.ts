/**
 * Parity Check Pipeline
 *
 * 5-phase pipeline that generates traces, sends them to both ES and CH,
 * fetches them back, and compares field-by-field.
 */

import { createRunPrefix, generateAllVariations } from "./otel-trace-generator.js";
import { setupDualExporterSDK } from "./sdk-trace-sender.js";
import { fetchAllTraces, pollUntilTracesReady } from "./trace-client.js";
import {
  compareAllTraces,
  validatePythonTraces,
  validateSnippetTraces,
} from "./trace-comparator.js";
import { runPythonExamples } from "./python-sdk-runner.js";
import { runOnboardingSnippets } from "./snippet-runner.js";
import {
  formatConsoleReport,
  formatVerboseFailures,
} from "./report-formatter.js";
import {
  createRunPrefixFilter,
  findSnippetTrace,
  buildTraceSummary,
} from "./trace-matcher.js";
import { sleep } from "./utils.js";
import type {
  Config,
  FieldSummary,
  ParityReport,
  PythonExampleResult,
  SnippetExampleResult,
  SnippetRunResult,
  SnippetSkipResult,
  Trace,
  TraceComparisonResult,
} from "./types.js";

export interface PipelineResult {
  report: ParityReport;
  overallPassed: boolean;
}

// Examples that intentionally produce no traces (e.g., disabled tracing, sampling=0)
const NO_TRACE_EXAMPLES = new Set([
  "openai_bot_disable_trace.py",
  "openai_bot_sampling_rate.py",
  "guardrails_without_tracing.py",
]);

/**
 * Execute the 5-phase parity check pipeline.
 */
export async function runParityPipeline(
  config: Config,
  verbose: boolean,
): Promise<PipelineResult> {
  const startTimestamp = Date.now();
  const runPrefix = createRunPrefix();
  console.log(`\nRun ID: ${runPrefix}`);

  // ─── Phase 1: Setup dual-exporter SDK ───
  console.log("\n[1/5] Setting up dual-exporter SDK...");
  const { tracer, flush, shutdown } = await setupDualExporterSDK(
    config.baseUrl,
    config.esApiKey,
    config.chApiKey,
    config.prodApiKey,
    runPrefix,
  );

  // ─── Phase 2: Generate OTEL traces ───
  console.log("\n[2/5] Generating and sending traces via OTEL SDK...");
  const { variations, totalTraces, timeRange } = await generateAllVariations(
    tracer,
    runPrefix,
    { tracesPerVariation: config.traceCount },
  );

  console.log(
    `\n  Generated ${variations.length} variations with ${totalTraces} total traces`,
  );
  variations.forEach((v) => {
    console.log(`    - ${v.name}: ${v.count} traces`);
  });
  console.log(
    `  Time range: ${new Date(timeRange.startDate).toISOString()} to ${new Date(timeRange.endDate).toISOString()}`,
  );

  console.log("\n  Flushing and shutting down SDK...");
  try {
    await flush();
    await shutdown();
  } catch (e) {
    console.log(
      `  Warning: SDK flush/shutdown error (traces likely already exported): ${e instanceof Error ? e.message : String(e)}`,
    );
  }
  console.log("  Both ES and CH received the same traces via dual exporters");

  // ─── Phase 3a: Run Python SDK examples (optional) ───
  const { pythonEsResults, pythonChResults } = await runPythonPhase(config, runPrefix);

  // ─── Phase 3b: Run onboarding snippets (optional) ───
  const { snippetResults, snippetEnvSkipped } = await runSnippetPhase(config);

  // ─── Phase 4: Poll for ingestion + fetch traces ───
  const { esTraces, chTraces } = await fetchPhase(
    config,
    totalTraces,
    timeRange,
    runPrefix,
  );

  // Fetch and validate Python SDK traces
  const pythonExampleResults = await fetchPythonTraces(
    config,
    pythonEsResults,
    pythonChResults,
  );

  // Fetch and validate onboarding snippet traces
  let snippetExampleResults = await fetchSnippetTraces(
    config,
    snippetResults,
  );

  // ─── Phase 5: Compare + report ───
  console.log("\n[5/5] Comparing traces...");

  let { results: traceResults, fieldSummaries } = compareAllTraces(
    esTraces,
    chTraces,
    config.tolerance,
  );

  // Retry failed trace comparisons (projection lag)
  ({ traceResults, fieldSummaries } = await retryFailedComparisons({
    traceResults,
    fieldSummaries,
    esTraces,
    config,
    timeRange,
    runPrefix,
  }));

  const report = assembleReport({
    runPrefix,
    startTimestamp,
    traceResults,
    fieldSummaries,
    pythonExampleResults,
    snippetExampleResults,
    snippetResults,
    snippetEnvSkipped,
  });

  // Print console report
  console.log(formatConsoleReport(report));

  // Verbose: print failed trace details
  if (verbose && report.otelTraces.failed > 0) {
    console.log(formatVerboseFailures(traceResults));
  }

  return { report, overallPassed: report.overallPassed };
}

// ─── Phase helpers ───

async function runPythonPhase(
  config: Config,
  runPrefix: string,
): Promise<{
  pythonEsResults: { exampleName: string; traceId: string | null; success: boolean }[];
  pythonChResults: { exampleName: string; traceId: string | null; success: boolean }[];
}> {
  let pythonEsResults: { exampleName: string; traceId: string | null; success: boolean }[] = [];
  let pythonChResults: { exampleName: string; traceId: string | null; success: boolean }[] = [];

  if (config.runPythonExamples) {
    console.log("\n[3/5] Running Python SDK examples...");
    try {
      const pyResults = await runPythonExamples({
        pythonSdkDir: config.pythonSdkDir,
        esApiKey: config.esApiKey,
        chApiKey: config.chApiKey,
        baseUrl: config.baseUrl,
        runPrefix,
      });
      pythonEsResults = pyResults.esResults;
      pythonChResults = pyResults.chResults;
    } catch (error) {
      console.log(
        `  Warning: Python SDK examples failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  } else {
    console.log("\n[3/5] Skipping Python SDK examples (disabled)");
  }

  return { pythonEsResults, pythonChResults };
}

async function runSnippetPhase(config: Config): Promise<{
  snippetResults: SnippetRunResult[];
  snippetEnvSkipped: { name: string; missingEnvVars: string[] }[];
}> {
  let snippetResults: SnippetRunResult[] = [];
  let snippetEnvSkipped: { name: string; missingEnvVars: string[] }[] = [];

  if (config.runSnippets) {
    console.log("\n[3b/5] Running onboarding snippets...");
    try {
      const snippetOutput = await runOnboardingSnippets({
        baseUrl: config.baseUrl,
        esApiKey: config.esApiKey,
        chApiKey: config.chApiKey,
      });
      snippetResults = snippetOutput.results;
      snippetEnvSkipped = snippetOutput.envSkipped;
    } catch (error) {
      console.log(
        `  Warning: Onboarding snippets failed: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  } else {
    console.log("\n[3b/5] Skipping onboarding snippets (disabled)");
  }

  return { snippetResults, snippetEnvSkipped };
}

async function fetchPhase(
  config: Config,
  totalTraces: number,
  timeRange: { startDate: number; endDate: number },
  runPrefix: string,
): Promise<{ esTraces: Trace[]; chTraces: Trace[] }> {
  console.log(
    `\n[4/5] Polling for trace ingestion (max wait: ${config.waitTimeMs}ms)...`,
  );

  const pollResult = await pollUntilTracesReady({
    baseUrl: config.baseUrl,
    esApiKey: config.esApiKey,
    chApiKey: config.chApiKey,
    expectedCount: totalTraces,
    startDate: timeRange.startDate,
    endDate: timeRange.endDate,
    maxWaitMs: config.waitTimeMs,
  });

  if (pollResult.esError || pollResult.chError) {
    console.log("\n  Warning: Errors during polling:");
    if (pollResult.esError)
      console.log(`    ES: ${pollResult.esError.slice(0, 100)}`);
    if (pollResult.chError)
      console.log(`    CH: ${pollResult.chError.slice(0, 100)}`);
  }

  if (!pollResult.esReady || !pollResult.chReady) {
    console.log(
      `\n  Warning: Not all traces ingested. ES: ${pollResult.esCount}/${totalTraces}, CH: ${pollResult.chCount}/${totalTraces}`,
    );
  }

  // Wait for event-sourcing projections to complete.
  console.log(
    "\n  Waiting 30 seconds for event-sourcing projections + indexing...",
  );
  await sleep(30000);

  console.log("  Fetching OTEL traces from both backends...");
  const [esTracesRaw, chTracesRaw] = await Promise.all([
    fetchAllTraces({
      baseUrl: config.baseUrl,
      apiKey: config.esApiKey,
      startDate: timeRange.startDate,
      endDate: timeRange.endDate,
    }),
    fetchAllTraces({
      baseUrl: config.baseUrl,
      apiKey: config.chApiKey,
      startDate: timeRange.startDate,
      endDate: timeRange.endDate,
    }),
  ]);

  const isOurTrace = createRunPrefixFilter(runPrefix);
  const esTraces = esTracesRaw.filter(isOurTrace);
  const chTraces = chTracesRaw.filter(isOurTrace);

  console.log(
    `  ES: ${esTraces.length}/${esTracesRaw.length} traces matched run prefix`,
  );
  console.log(
    `  CH: ${chTraces.length}/${chTracesRaw.length} traces matched run prefix`,
  );

  return { esTraces, chTraces };
}

async function fetchPythonTraces(
  config: Config,
  pythonEsResults: { exampleName: string; traceId: string | null; success: boolean }[],
  pythonChResults: { exampleName: string; traceId: string | null; success: boolean }[],
): Promise<PythonExampleResult[]> {
  if (
    !config.runPythonExamples ||
    (pythonEsResults.length === 0 && pythonChResults.length === 0)
  ) {
    return [];
  }

  console.log("  Fetching Python SDK traces...");

  const esTracesByExample = new Map(
    pythonEsResults
      .filter((r) => r.traceId)
      .map((r) => [r.exampleName, r.traceId!]),
  );
  const chTracesByExample = new Map(
    pythonChResults
      .filter((r) => r.traceId)
      .map((r) => [r.exampleName, r.traceId!]),
  );

  const allExamples = new Set([
    ...esTracesByExample.keys(),
    ...chTracesByExample.keys(),
  ]);

  const pythonFetchRange = {
    startDate: Date.now() - 60 * 60 * 1000,
    endDate: Date.now() + 10 * 60 * 1000,
  };

  const [esPythonTraces, chPythonTraces] = await Promise.all([
    fetchAllTraces({
      baseUrl: config.baseUrl,
      apiKey: config.esApiKey,
      startDate: pythonFetchRange.startDate,
      endDate: pythonFetchRange.endDate,
    }),
    fetchAllTraces({
      baseUrl: config.baseUrl,
      apiKey: config.chApiKey,
      startDate: pythonFetchRange.startDate,
      endDate: pythonFetchRange.endDate,
    }),
  ]);

  const esTraceMap = new Map(esPythonTraces.map((t) => [t.trace_id, t]));
  const chTraceMap = new Map(chPythonTraces.map((t) => [t.trace_id, t]));

  const results: PythonExampleResult[] = [];
  for (const exampleName of allExamples) {
    if (NO_TRACE_EXAMPLES.has(exampleName)) continue;

    const esTraceId = esTracesByExample.get(exampleName) ?? null;
    const chTraceId = chTracesByExample.get(exampleName) ?? null;

    const esTrace: Trace | null = esTraceId
      ? esTraceMap.get(esTraceId) ?? null
      : null;
    const chTrace: Trace | null = chTraceId
      ? chTraceMap.get(chTraceId) ?? null
      : null;

    results.push(
      validatePythonTraces({ exampleName, esTrace, chTrace, esTraceId, chTraceId }),
    );
  }

  return results;
}

async function fetchSnippetTraces(
  config: Config,
  snippetResults: SnippetRunResult[],
): Promise<SnippetExampleResult[]> {
  const successfulSnippets = snippetResults.filter(
    (r) => r.esRun.success || r.chRun.success,
  );

  if (!config.runSnippets || successfulSnippets.length === 0) {
    return [];
  }

  console.log("  Fetching onboarding snippet traces...");

  const allStartTimes = successfulSnippets
    .flatMap((r) => [
      r.esRun.success ? r.esRun.startTime : Infinity,
      r.chRun.success ? r.chRun.startTime : Infinity,
    ])
    .filter((t) => t !== Infinity);
  const allEndTimes = successfulSnippets
    .flatMap((r) => [
      r.esRun.success ? r.esRun.endTime : 0,
      r.chRun.success ? r.chRun.endTime : 0,
    ])
    .filter((t) => t !== 0);

  const snippetFetchRange = {
    startDate: Math.min(...allStartTimes) - 60 * 1000,
    endDate: Math.max(...allEndTimes) + 10 * 60 * 1000,
  };

  async function fetchAndValidate(): Promise<SnippetExampleResult[]> {
    const [esSnippetTraces, chSnippetTraces] = await Promise.all([
      fetchAllTraces({
        baseUrl: config.baseUrl,
        apiKey: config.esApiKey,
        startDate: snippetFetchRange.startDate,
        endDate: snippetFetchRange.endDate,
      }),
      fetchAllTraces({
        baseUrl: config.baseUrl,
        apiKey: config.chApiKey,
        startDate: snippetFetchRange.startDate,
        endDate: snippetFetchRange.endDate,
      }),
    ]);

    const results: SnippetExampleResult[] = [];
    for (const snippet of successfulSnippets) {
      const esMatch = snippet.esRun.success
        ? findSnippetTrace({
            traces: esSnippetTraces,
            serviceName: snippet.esRun.serviceName,
            startTime: snippet.esRun.startTime,
            endTime: snippet.esRun.endTime,
          })
        : null;
      const chMatch = snippet.chRun.success
        ? findSnippetTrace({
            traces: chSnippetTraces,
            serviceName: snippet.chRun.serviceName,
            startTime: snippet.chRun.startTime,
            endTime: snippet.chRun.endTime,
          })
        : null;

      const esTrace = esMatch?.trace ?? null;
      const chTrace = chMatch?.trace ?? null;

      const validated = validateSnippetTraces({
        snippetName: snippet.snippetName,
        esTrace,
        chTrace,
        esTraceId: esTrace?.trace_id ?? null,
        chTraceId: chTrace?.trace_id ?? null,
      });

      validated.esMatchMethod = esMatch?.matchMethod ?? null;
      validated.chMatchMethod = chMatch?.matchMethod ?? null;
      validated.esSummary = esTrace ? buildTraceSummary(esTrace) : null;
      validated.chSummary = chTrace ? buildTraceSummary(chTrace) : null;

      results.push(validated);
    }
    return results;
  }

  let snippetExampleResults = await fetchAndValidate();

  // Retry: wait for event-sourcing projections if any snippets have issues
  const issueCount = snippetExampleResults.filter(
    (r) => !r.structuralMatch,
  ).length;
  if (issueCount > 0) {
    console.log(
      `  ${issueCount} snippet(s) have issues. Retrying after 30s for projection lag...`,
    );
    await sleep(30000);

    const retryResults = await fetchAndValidate();
    const retryIssueCount = retryResults.filter(
      (r) => !r.structuralMatch,
    ).length;

    if (retryIssueCount < issueCount) {
      console.log(
        `  Retry improved: ${issueCount} → ${retryIssueCount} issues`,
      );
      snippetExampleResults = retryResults;
    } else {
      console.log(
        `  Retry: still ${retryIssueCount} issues (not a timing problem)`,
      );
    }
  }

  return snippetExampleResults;
}

async function retryFailedComparisons({
  traceResults,
  fieldSummaries,
  esTraces,
  config,
  timeRange,
  runPrefix,
}: {
  traceResults: TraceComparisonResult[];
  fieldSummaries: FieldSummary[];
  esTraces: Trace[];
  config: Config;
  timeRange: { startDate: number; endDate: number };
  runPrefix: string;
}): Promise<{
  traceResults: TraceComparisonResult[];
  fieldSummaries: FieldSummary[];
}> {
  const failedTraceIds = traceResults
    .filter((r) => !r.passed)
    .map((r) => r.traceId);

  if (failedTraceIds.length === 0 || failedTraceIds.length > 5) {
    return { traceResults, fieldSummaries };
  }

  console.log(
    `\n  ${failedTraceIds.length} trace(s) failed. Retrying after 30s to check for projection lag...`,
  );
  await sleep(30000);

  const retryChTracesRaw = await fetchAllTraces({
    baseUrl: config.baseUrl,
    apiKey: config.chApiKey,
    startDate: timeRange.startDate,
    endDate: timeRange.endDate,
  });
  const isOurTrace = createRunPrefixFilter(runPrefix);
  const retryChTraces = retryChTracesRaw.filter(isOurTrace);
  console.log(`  Re-fetched ${retryChTraces.length} CH traces`);

  const retryResult = compareAllTraces(
    esTraces,
    retryChTraces,
    config.tolerance,
  );
  const retryFailedCount = retryResult.results.filter(
    (r) => !r.passed,
  ).length;

  if (retryFailedCount < failedTraceIds.length) {
    console.log(
      `  Retry improved: ${failedTraceIds.length} → ${retryFailedCount} failures (projection lag confirmed)`,
    );
    return {
      traceResults: retryResult.results,
      fieldSummaries: retryResult.fieldSummaries,
    };
  }

  console.log(
    `  Retry: still ${retryFailedCount} failures (not a timing issue)`,
  );
  return { traceResults, fieldSummaries };
}

// ─── Report assembly ───

function assembleReport({
  runPrefix,
  startTimestamp,
  traceResults,
  fieldSummaries,
  pythonExampleResults,
  snippetExampleResults,
  snippetResults,
  snippetEnvSkipped,
}: {
  runPrefix: string;
  startTimestamp: number;
  traceResults: TraceComparisonResult[];
  fieldSummaries: FieldSummary[];
  pythonExampleResults: PythonExampleResult[];
  snippetExampleResults: SnippetExampleResult[];
  snippetResults: SnippetRunResult[];
  snippetEnvSkipped: { name: string; missingEnvVars: string[] }[];
}): ParityReport {
  const otelPassed = traceResults.filter((r) => r.passed).length;
  const otelFailed = traceResults.filter((r) => !r.passed).length;

  const pythonSdkReport =
    pythonExampleResults.length > 0
      ? {
          totalValidated: pythonExampleResults.length,
          esOk: pythonExampleResults.filter((r) => r.esTrace !== null).length,
          chOk: pythonExampleResults.filter((r) => r.chTrace !== null).length,
          results: pythonExampleResults,
        }
      : null;

  const overallPassed = otelFailed === 0;

  // Build skipped/failed snippet list
  const snippetSkipped = buildSnippetSkipList(
    snippetExampleResults,
    snippetResults,
    snippetEnvSkipped,
  );

  const snippetIssueCount = snippetExampleResults.filter(
    (r) => !r.structuralMatch,
  ).length;
  const snippetsReport =
    snippetResults.length > 0 || snippetEnvSkipped.length > 0
      ? {
          totalRun: snippetResults.length,
          totalValidated: snippetExampleResults.length,
          esOk: snippetExampleResults.filter((r) => r.esTrace !== null).length,
          chOk: snippetExampleResults.filter((r) => r.chTrace !== null).length,
          results: snippetExampleResults,
          skipped: snippetSkipped,
        }
      : null;

  const endTimestamp = Date.now();

  return {
    timestamp: new Date().toISOString(),
    runId: runPrefix,
    summary: {
      overallPassed,
      otelTraces: {
        total: traceResults.length,
        passed: otelPassed,
        failed: otelFailed,
      },
      snippets: snippetsReport
        ? {
            total: snippetResults.length + snippetEnvSkipped.length,
            validated: snippetExampleResults.length,
            passed: snippetExampleResults.length - snippetIssueCount,
            issues: snippetIssueCount,
            skipped: snippetSkipped.length,
          }
        : null,
      pythonSdk: pythonSdkReport
        ? {
            total: pythonSdkReport.totalValidated,
            esOk: pythonSdkReport.esOk,
            chOk: pythonSdkReport.chOk,
          }
        : null,
      totalDurationMs: endTimestamp - startTimestamp,
    },
    otelTraces: {
      totalCompared: traceResults.length,
      passed: otelPassed,
      failed: otelFailed,
      traceResults,
      fieldSummaries,
    },
    pythonSdk: pythonSdkReport,
    snippets: snippetsReport,
    overallPassed,
  };
}

function buildSnippetSkipList(
  snippetExampleResults: SnippetExampleResult[],
  snippetResults: SnippetRunResult[],
  snippetEnvSkipped: { name: string; missingEnvVars: string[] }[],
): SnippetSkipResult[] {
  const snippetSkipped: SnippetSkipResult[] = [];
  const validatedSnippetNames = new Set(
    snippetExampleResults.map((r) => r.snippetName),
  );

  for (const skip of snippetEnvSkipped) {
    snippetSkipped.push({
      snippetName: skip.name,
      reason: "skipped",
      missingEnvVars: skip.missingEnvVars,
    });
  }

  for (const snippet of snippetResults) {
    if (validatedSnippetNames.has(snippet.snippetName)) continue;

    const esFailed = !snippet.esRun.success;
    const chFailed = !snippet.chRun.success;

    if (esFailed && chFailed) {
      snippetSkipped.push({
        snippetName: snippet.snippetName,
        reason: "both_failed",
        esError: snippet.esRun.error,
        chError: snippet.chRun.error,
      });
    } else if (esFailed) {
      snippetSkipped.push({
        snippetName: snippet.snippetName,
        reason: "es_failed",
        esError: snippet.esRun.error,
      });
    } else if (chFailed) {
      snippetSkipped.push({
        snippetName: snippet.snippetName,
        reason: "ch_failed",
        chError: snippet.chRun.error,
      });
    }
  }

  return snippetSkipped;
}
