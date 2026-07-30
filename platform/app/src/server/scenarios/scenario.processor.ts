/**
 * Scenario execution processor.
 *
 * Spawns isolated child processes for scenario execution to achieve OTEL
 * trace isolation. Each scenario runs in its own process with separate
 * LANGWATCH_API_KEY and LANGWATCH_ENDPOINT env vars.
 *
 * Execution is triggered by the `scenarioExecution` process manager's leased
 * outbox (ADR-073 step 2, retired; ground now ADR-103), which holds the run's lease for the whole child
 * process and therefore bounds concurrency itself.
 *
 * @see specs/scenarios/simulation-runner.feature
 * @see specs/scenarios/scenario-execution-process-manager.feature
 */

import { createLogger } from "@langwatch/observability";
import { type ChildProcess, spawn } from "child_process";
import path from "path";
import { env } from "~/env.mjs";
import { getSharedClickHouseClient } from "../clickhouse/clickhouseClient";
import {
  createContextFromJobData,
  type JobContextMetadata,
  runWithContext,
} from "../context/asyncContext";
import { prisma } from "../db";
import {
  getJobProcessingCounter,
  getJobProcessingDurationHistogram,
} from "../metrics";
import { connection } from "../redis";
import {
  type CancellationMessage,
  subscribeToCancellations,
} from "./cancellation-channel";
import {
  encodeScenarioLogContext,
  SCENARIO_LOG_CONTEXT_ENV,
} from "./execution/child-logger";
import { resolveChildProcessSpawn } from "./execution/child-process-spawn";
import { resolveChildTlsEnv } from "./execution/child-tls-env";
import {
  createDataPrefetcherDependencies,
  prefetchScenarioData,
} from "./execution/data-prefetcher";
import type {
  ExecutionJobData,
  ScenarioExecutionPool,
} from "./execution/execution-pool";
import type {
  ChildProcessJobData,
  ScenarioExecutionResult,
} from "./execution/types";
import { reconcileOrphanedRunsOnBoot } from "./orphaned-run-reconciliation.clickhouse";
import { CHILD_PROCESS, SCENARIO_WORKER } from "./scenario.constants";
import { ScenarioService } from "./scenario.service";
import {
  type FailureEventParams,
  ScenarioFailureHandler,
} from "./scenario-failure-handler";
import { classifyScenarioInfraError } from "./scenario-infra-error";
import {
  findQueuedRunCandidates,
  LOOKBACK_MS,
  ORPHAN_QUEUED_THRESHOLD_MS,
  reconcileOrphanedQueuedRuns,
} from "./scenario-orphan-reconciler";

// ============================================================================
// Dependency Interfaces (Dependency Inversion Principle)
// ============================================================================

/** Minimal interface for scenario lookup in failure handler */
export interface ScenarioLookup {
  getById(params: { projectId: string; id: string }): Promise<{
    name: string;
    situation: string;
  } | null>;
}

/** Minimal interface for failure event emission */
export interface FailureEmitter {
  ensureFailureEventsEmitted(params: FailureEventParams): Promise<void>;
}

/** Dependencies for the scenario processor's failure handling */
export interface ProcessorDependencies {
  scenarioLookup: ScenarioLookup;
  failureEmitter: FailureEmitter;
}

// ============================================================================
// Factory Function (wires up production dependencies)
// ============================================================================

/**
 * Creates production dependencies for the scenario processor.
 */
export function createProcessorDependencies(): ProcessorDependencies {
  const scenarioService = ScenarioService.create(prisma);
  const failureHandler = ScenarioFailureHandler.create();

  return {
    scenarioLookup: {
      getById: (params) => scenarioService.getById(params),
    },
    failureEmitter: {
      ensureFailureEventsEmitted: (params) =>
        failureHandler.ensureFailureEventsEmitted(params),
    },
  };
}

// ============================================================================
// Failure Handling (Single Responsibility)
// ============================================================================

/**
 * Handle a failed job result by emitting failure events.
 */
export async function handleFailedJobResult(
  jobData: ExecutionJobData,
  error: string | undefined,
  deps: ProcessorDependencies,
): Promise<void> {
  const scenario = await deps.scenarioLookup.getById({
    projectId: jobData.projectId,
    id: jobData.scenarioId,
  });

  await deps.failureEmitter.ensureFailureEventsEmitted({
    projectId: jobData.projectId,
    scenarioId: jobData.scenarioId,
    setId: jobData.setId,
    batchRunId: jobData.batchRunId,
    scenarioRunId: jobData.scenarioRunId,
    error,
    name: scenario?.name,
    description: scenario?.situation,
  });
}

/**
 * Handle a cancelled job result by emitting cancellation events.
 */
export async function handleCancelledJobResult(
  jobData: ExecutionJobData,
  error: string | undefined,
  deps: ProcessorDependencies,
): Promise<void> {
  const scenario = await deps.scenarioLookup.getById({
    projectId: jobData.projectId,
    id: jobData.scenarioId,
  });

  await deps.failureEmitter.ensureFailureEventsEmitted({
    projectId: jobData.projectId,
    scenarioId: jobData.scenarioId,
    setId: jobData.setId,
    batchRunId: jobData.batchRunId,
    scenarioRunId: jobData.scenarioRunId,
    error: error ?? "Cancelled by user",
    name: scenario?.name,
    description: scenario?.situation,
    outcome: "cancelled",
  });
}

const logger = createLogger("langwatch:scenarios:processor");

/**
 * Kill every child this worker holds, and record a terminal state for each of
 * their runs before the process leaves.
 *
 * A deploy is the most common way a run loses its worker, and the only one
 * where the worker is still alive to say so. Killing the children and exiting
 * leaves the write to a race — each child's own close handler tries to record
 * the failure, but nothing waits for it — and when that race is lost the run
 * sits non-terminal until the process manager's deadline fires against it,
 * roughly half an hour later. Writing it here costs a second. This is the
 * mitigation ADR-073 (retired; ground now ADR-103) names in "Deleting the
 * drain costs deploy latency".
 *
 * It does NOT replace the deadline, and is not written as though it could: a
 * hard kill reaches none of this, `finishRun` is idempotent so a child that
 * records its own death first simply wins, and anything this cannot finish
 * inside `timeoutMs` is left to the deadline rather than allowed to hold the
 * shutdown open past the pod's termination grace period.
 *
 * Runs still in their prefetch window are deliberately out of scope: nothing
 * has been spawned for them, so their dispatch is still a leased outbox row
 * that is redelivered and executed for real — a better outcome than recording
 * a failure for a run the customer never got.
 */
export async function settleInFlightRuns({
  pool,
  deps,
  timeoutMs = SCENARIO_WORKER.SHUTDOWN_SETTLE_TIMEOUT_MS,
}: {
  pool: ScenarioExecutionPool;
  deps: ProcessorDependencies;
  timeoutMs?: number;
}): Promise<void> {
  // Read before signalling: an exiting child removes itself from the registry,
  // so a view taken after `drain()` is already losing entries.
  const inFlight = pool.inFlightJobs;
  pool.drain();
  if (inFlight.length === 0) return;

  logger.info(
    { count: inFlight.length, timeoutMs },
    "Shutting down: recording a terminal state for the runs this worker holds",
  );

  // Per-run isolation, so one rejected write cannot strand the others.
  const recorded = Promise.all(
    inFlight.map(async (jobData) => {
      try {
        if (pool.wasCancelled(jobData.scenarioRunId)) {
          await handleCancelledJobResult(
            jobData,
            "Cancelled before execution finished",
            deps,
          );
        } else {
          await handleFailedJobResult(
            jobData,
            "Worker restarting — scenario run terminated before completion",
            deps,
          );
        }
      } catch (err) {
        logger.warn(
          { err, scenarioRunId: jobData.scenarioRunId },
          "Could not record a terminal state on shutdown — leaving the run to its deadline",
        );
      }
    }),
  );

  let budget: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([
    recorded,
    new Promise<void>((resolve) => {
      budget = setTimeout(() => {
        logger.warn(
          { count: inFlight.length, timeoutMs },
          "Shutdown budget spent before every run was recorded — the rest keep their deadlines",
        );
        resolve();
      }, timeoutMs);
    }),
  ]);
  if (budget) clearTimeout(budget);
}

/**
 * Creates a child logger with scenario job context bound.
 */
function createScenarioLogger(jobData: ExecutionJobData) {
  return logger.child({
    scenarioId: jobData.scenarioId,
    projectId: jobData.projectId,
    batchRunId: jobData.batchRunId,
    setId: jobData.setId,
    scenarioRunId: jobData.scenarioRunId,
  });
}

/**
 * Build OTEL resource attributes string for scenario labels and platform source.
 * @internal Exported for testing
 */
export function buildOtelResourceAttributes(labels: string[]): string {
  const parts = ["langwatch.origin.source=platform"];
  if (labels.length) {
    const escapedLabels = labels.map((l) =>
      l.replace(/\\/g, "\\\\").replace(/[,=]/g, "\\$&"),
    );
    parts.push(`scenario.labels=${escapedLabels.join(",")}`);
  }
  return parts.join(",");
}

/**
 * Build minimal env for child process - whitelist only what's needed.
 * @internal Exported for testing
 */
export function buildChildProcessEnv(
  scenarioVars: Record<string, string | undefined>,
): NodeJS.ProcessEnv {
  const vars: Record<string, string | undefined> = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    USER: process.env.USER,
    SHELL: process.env.SHELL,
    LANG: process.env.LANG,
    LC_ALL: process.env.LC_ALL,
    TERM: process.env.TERM,
    NODE_ENV: process.env.NODE_ENV,
    NODE_OPTIONS: process.env.NODE_OPTIONS,
    SKIP_ENV_VALIDATION: "1",
    COREPACK_ENABLE_DOWNLOAD_PROMPT:
      process.env.COREPACK_ENABLE_DOWNLOAD_PROMPT,
    ...scenarioVars,
  };

  return Object.fromEntries(
    Object.entries(vars).filter(([, v]) => v !== undefined),
  ) as NodeJS.ProcessEnv;
}

/** The runner's structured stdout result line. */
export interface ChildProcessResult {
  success: boolean;
  error?: string;
  reasoning?: string;
}

/** Parse a single stdout line as the runner's result, or null if it isn't one. */
function parseResultLine(line: string): ChildProcessResult | null {
  const trimmed = line.trim();
  if (!trimmed.startsWith("{") || !trimmed.endsWith("}")) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(trimmed);
  } catch {
    return null;
  }
  if (typeof parsed !== "object" || parsed === null) return null;
  const record = parsed as Record<string, unknown>;
  if (typeof record.success !== "boolean") return null;
  return {
    success: record.success,
    ...(typeof record.error === "string" ? { error: record.error } : {}),
    ...(typeof record.reasoning === "string"
      ? { reasoning: record.reasoning }
      : {}),
  };
}

/**
 * Extract the runner's structured result from its stdout.
 *
 * The runner emits its logs (pino JSON) AND its final result line
 * (`{"success":false,"error":"…"}`) on stdout; the result line is the only one
 * carrying a boolean `success`. Scanning from the end returns it without
 * mistaking a log line for the result. This lets the parent surface the child's
 * real error (e.g. the flattened TLS cause) instead of the near-empty stderr.
 *
 * @internal Exported for testing
 */
export function parseChildProcessResult(
  stdout: string,
): ChildProcessResult | null {
  const lines = stdout.split("\n");
  for (let i = lines.length - 1; i >= 0; i--) {
    const result = parseResultLine(lines[i] ?? "");
    if (result) return result;
  }
  return null;
}

/**
 * Execute a scenario run by spawning an isolated child process.
 *
 * Called by the `scenarioExecution` process outbox while it holds the run's
 * lease, so this resolves only when the child is done. Concurrency is the
 * dispatcher's; the pool only tracks the running children so cancellation can
 * find them.
 */
export async function executeScenarioRun(
  jobData: ExecutionJobData,
  pool: ScenarioExecutionPool,
  deps: ProcessorDependencies = createProcessorDependencies(),
): Promise<void> {
  const contextMetadata: JobContextMetadata = {
    projectId: jobData.projectId,
  };
  const requestContext = createContextFromJobData(contextMetadata);
  const jobLogger = createScenarioLogger(jobData);

  await runWithContext(requestContext, async () => {
    const startTime = Date.now();

    // A cancel that landed before this dispatch was leased. Checked here
    // rather than in the pool, which no longer decides when a job starts.
    if (pool.wasCancelled(jobData.scenarioRunId)) {
      jobLogger.info("Scenario cancelled before execution started");
      await handleCancelledJobResult(
        jobData,
        "Cancelled before execution started",
        deps,
      );
      return;
    }

    getJobProcessingCounter("scenario", "processing").inc();
    jobLogger.info("Processing scenario job");

    const prefetchDeps = createDataPrefetcherDependencies();
    const prefetchResult = await prefetchScenarioData(
      {
        projectId: jobData.projectId,
        scenarioId: jobData.scenarioId,
        setId: jobData.setId,
        batchRunId: jobData.batchRunId,
        scenarioRunId: jobData.scenarioRunId,
      },
      jobData.target,
      prefetchDeps,
    );

    // Check if cancellation was requested while we were prefetching
    if (pool.wasCancelled(jobData.scenarioRunId)) {
      jobLogger.info("Scenario cancelled during prefetch");
      await handleCancelledJobResult(
        jobData,
        "Cancelled before execution started",
        deps,
      );
      return;
    }

    if (!prefetchResult.success) {
      jobLogger.error(
        { error: prefetchResult.error, phase: "prefetch" },
        "Failed to prefetch scenario data",
      );
      await handleFailedJobResult(jobData, prefetchResult.error, deps);
      return;
    }

    jobLogger.debug(
      { durationMs: Date.now() - startTime, phase: "prefetch" },
      "Scenario data prefetched",
    );

    const childProcessData = {
      ...prefetchResult.data,
      scenarioRunId: jobData.scenarioRunId,
    };

    const childStartTime = Date.now();
    const result = await spawnScenarioChildProcess(
      jobData,
      childProcessData,
      prefetchResult.telemetry,
      pool,
    );

    const totalDurationMs = Date.now() - startTime;
    const childDurationMs = Date.now() - childStartTime;

    if (result.success) {
      getJobProcessingCounter("scenario", "completed").inc();
      getJobProcessingDurationHistogram("scenario").observe(totalDurationMs);
      jobLogger.info(
        { success: true, totalDurationMs, childDurationMs },
        "Scenario job completed",
      );
    } else if (result.cancelled) {
      jobLogger.info("Scenario job cancelled by user");
      await handleCancelledJobResult(jobData, result.error, deps);
    } else {
      getJobProcessingCounter("scenario", "failed").inc();
      // The classified code, not the raw failure text. `result.error` is
      // whatever the runner or its stderr produced, which is the simulated
      // conversation and the judge's verdict about it — customer content that
      // must not land in the platform's own log retention. The code is enough
      // to tell an operator why the run died; the raw text stays at debug.
      jobLogger.warn(
        {
          success: false,
          errorCode: classifyScenarioInfraError(result.error).code,
          totalDurationMs,
          childDurationMs,
        },
        "Scenario job completed with failure",
      );
      jobLogger.debug(
        { error: result.error },
        "Scenario job failure, raw runner error",
      );
      await handleFailedJobResult(jobData, result.error, deps);
    }
  });
}

/**
 * Spawn a child process to execute the scenario with isolated OTEL context.
 */
async function spawnScenarioChildProcess(
  jobData: ExecutionJobData,
  childProcessData: ChildProcessJobData,
  telemetry: { endpoint: string; apiKey: string },
  pool: ScenarioExecutionPool,
): Promise<ScenarioExecutionResult> {
  return new Promise((resolve) => {
    const { scenarioId, projectId, batchRunId, setId } = jobData;
    const childLogger = logger.child({
      scenarioId,
      projectId,
      batchRunId,
      setId,
      scenarioRunId: jobData.scenarioRunId,
      component: "child-process",
    });

    const log = (
      level: "debug" | "info" | "warn" | "error",
      message: string,
      extra?: Record<string, unknown>,
    ) => {
      childLogger[level](extra ?? {}, message);
    };

    const otelResourceAttrs = buildOtelResourceAttributes(
      childProcessData.scenario.labels,
    );
    const logContext = encodeScenarioLogContext({
      scenarioRunId: jobData.scenarioRunId,
      batchRunId,
      projectId,
      scenarioId,
      setId,
    });
    // TLS for the runner's own fetch stack (EventReporter → platform, and the
    // model API call). Forwards haven's trusted local CA when present; only in
    // local non-SaaS dev does it fall back to relaxing TLS. Never in SaaS/prod.
    // See resolveChildTlsEnv for the gating.
    const tlsEnv = resolveChildTlsEnv({
      isSaaS: !!env.IS_SAAS,
      nodeEnv: process.env.NODE_ENV,
      nodeExtraCaCerts: process.env.NODE_EXTRA_CA_CERTS,
    });
    const childEnv = buildChildProcessEnv({
      LANGWATCH_API_KEY: telemetry.apiKey,
      LANGWATCH_ENDPOINT: telemetry.endpoint,
      SCENARIO_HEADLESS: "true",
      OTEL_RESOURCE_ATTRIBUTES: otelResourceAttrs,
      [SCENARIO_LOG_CONTEXT_ENV]: logContext,
      ...tlsEnv,
    });

    const packageRoot = path.resolve(__dirname, "../../..");
    const spawnStart = Date.now();
    const { command, args } = resolveChildProcessSpawn({
      packageRoot,
      nodeEnv: process.env.NODE_ENV,
    });
    log("info", "Spawning scenario child process", { command, args });
    const child: ChildProcess = spawn(command, args, {
      env: childEnv,
      stdio: ["pipe", "pipe", "pipe"],
      cwd: packageRoot,
    });
    log("info", "Child process spawned", {
      pid: child.pid,
      spawnMs: Date.now() - spawnStart,
    });

    // Register in the pool so cancel broadcasts can find this child, and so a
    // shutdown knows which run it is about to abandon.
    pool.registerChild({ job: jobData, child });

    let stderr = "";
    let stdout = "";
    let resolved = false;

    const cleanup = () => {
      if (!resolved) {
        resolved = true;
        child.kill();
      }
    };

    const timeout = setTimeout(() => {
      log("error", "Child process timed out", {
        timeoutMs: CHILD_PROCESS.TIMEOUT_MS,
      });
      cleanup();
      resolve({
        success: false,
        error: "Scenario execution timed out",
      });
    }, CHILD_PROCESS.TIMEOUT_MS);

    // The child's output is CUSTOMER CONTENT, not our diagnostics. Its own
    // pino logger writes to stdout — including the judge's `reasoning`, which
    // is verdict text about the simulated conversation — and its structured
    // result line carries the same. Re-emitting those lines at `info`/`warn`
    // copied every one of them verbatim into the platform's log retention.
    //
    // So the raw stream is forwarded at `debug` and nowhere else, and the
    // result line is read from the accumulated `stdout` at close (see
    // `parseChildProcessResult`) rather than by re-emitting lines as they
    // arrive. Everything an operator needs at `info` — spawn, pid, exit code,
    // classified failure reason — is logged by this file in its own words.
    child.stdout?.on("data", (data: Buffer) => {
      const chunk = data.toString();
      stdout += chunk;
      const lines = chunk.trim().split("\n");
      for (const line of lines) {
        if (line) log("debug", line);
      }
    });

    child.stderr?.on("data", (data: Buffer) => {
      const chunk = data.toString();
      stderr += chunk;
      const lines = chunk.trim().split("\n");
      for (const line of lines) {
        if (line) log("debug", line);
      }
    });

    child.on("close", (code) => {
      clearTimeout(timeout);
      pool.deregisterChild(jobData.scenarioRunId);
      if (resolved) return;
      resolved = true;

      // Check if this was killed by the cancel subscription
      if (pool.wasCancelled(jobData.scenarioRunId)) {
        log("info", "Job cancelled via cancel broadcast");
        resolve({
          success: false,
          error: "Job was cancelled",
          cancelled: true,
        });
        return;
      }

      if (code !== 0) {
        // Prefer the runner's own structured error (its flattened cause chain,
        // e.g. the TLS reason) over the near-empty stderr — the failure handler
        // classifies this string into a handled error for the drawer.
        const childResult = parseChildProcessResult(stdout);
        const error =
          childResult?.error && childResult.error.trim().length > 0
            ? childResult.error
            : `Child process exited with code ${code}: ${stderr}`;
        // Exit code + classified reason is what an operator needs, and neither
        // quotes the child. The raw stderr is an unbounded, unsanitised stream
        // (it can carry the conversation the run was about), so it stays at
        // debug.
        log("error", `Child process exited with code ${code}`, {
          exitCode: code,
          errorCode: classifyScenarioInfraError(error).code,
        });
        log("debug", "Child process stderr", { exitCode: code, stderr });
        resolve({
          success: false,
          error,
        });
        return;
      }

      log("info", "Scenario completed successfully", { exitCode: code });
      resolve({ success: true });
    });

    child.on("error", (error) => {
      clearTimeout(timeout);
      pool.deregisterChild(jobData.scenarioRunId);
      if (resolved) return;
      resolved = true;

      log("error", `Child process error: ${error.message}`);
      resolve({
        success: false,
        error: `Child process error: ${error.message}`,
      });
    });

    if (child.stdin) {
      child.stdin.on("error", (err) => {
        log("warn", "Child stdin error", { error: err.message });
      });
      try {
        child.stdin.write(JSON.stringify(childProcessData));
        child.stdin.end();
      } catch (err) {
        log("warn", "Child stdin write failed", {
          error: (err as Error).message,
        });
      }
    }
  });
}

/**
 * Start the scenario processor.
 *
 * Sets up the cancel subscription (Redis pub/sub). Job execution itself is
 * driven by the `scenarioExecution` process outbox, which calls
 * {@link executeScenarioRun} while holding the run's lease.
 *
 * @returns A shutdown handle, or undefined if Redis is not available.
 */
export async function startScenarioProcessor(
  pool: ScenarioExecutionPool,
  deps: ProcessorDependencies = createProcessorDependencies(),
): Promise<{ close: () => Promise<void> } | undefined> {
  if (!connection) {
    logger.info("No Redis connection, skipping scenario processor");
    return undefined;
  }

  // Subscribe to cancellation signals from the event-sourcing pipeline
  const subscriber = connection.duplicate();
  const unsubscribe = await subscribeToCancellations({
    subscriber,
    onCancel: (message: CancellationMessage) => {
      const child = pool.findChild(message.scenarioRunId);
      if (child) {
        logger.info(
          { scenarioRunId: message.scenarioRunId, pid: child.pid },
          "Killing child process via event-sourcing cancel broadcast",
        );
        child.kill("SIGTERM");
      }
      pool.markCancelled(message.scenarioRunId);
    },
  });

  logger.info("Scenario processor started (event-driven)");

  // Ongoing stuck-run recovery is NOT here any more. Two cross-tenant
  // ClickHouse sweeps used to run at this point — one for runs orphaned at
  // QUEUED, one for runs orphaned at IN_PROGRESS — and because they ran only
  // at boot, the recovery bound was the deploy cadence: a run abandoned an
  // hour after the last restart waited for the next one.
  //
  // The `scenarioExecution` process manager on the simulation pipeline holds
  // that guarantee continuously now. Every progress event re-arms its durable
  // deadline; when one fires, it writes the terminal state itself. See
  // ADR-073 (retired; ground now ADR-103).
  // The graceful drain survives alongside it (`settleInFlightRuns`, on
  // `close()` below) — not as the guarantee, but because waiting out a
  // half-hour deadline for something the worker knew at SIGTERM is a bad deal
  // on the one path that happens every deploy.
  //
  // ── CUTOVER AID — DELETE ONE RELEASE AFTER ADR-073 SHIPS ──────────────────
  //
  // The sweeps still run, once per boot, for exactly one population: runs that
  // were already stuck when this version deployed. The process manager arms
  // deadlines from live events only — it does not replay history and does not
  // seed `ProcessManagerInstance` rows for runs that went quiet before it
  // existed. Those rows have no heartbeat, no `nextWakeAt`, and nothing else
  // that would ever terminalise them: `STALLED` is a stored status, not a
  // read-time derivation, so they would sit non-terminal in the UI forever —
  // the precise failure the sweeps were written for (#3195).
  //
  // So they are kept as a drain, not as the mechanism. Once a release has
  // passed with the process manager live, no run predating it can still be
  // open, this block and the three modules it calls are dead, and they go.
  //
  // BOOT-ONLY AND THRESHOLDED IS A DELIBERATE GAP, NOT AN OVERSIGHT. A run
  // that went quiet less than `ORPHAN_QUEUED_THRESHOLD_MS` (30 min) before the
  // cutover rollout is under the threshold at every boot in that rollout, so
  // no sweep in it takes the run terminal, and the next sweep is the next
  // restart. Three things make that acceptable rather than worth a repeating
  // timer. The release being replaced settles its own in-flight runs on
  // SIGTERM, and a rolling deploy is graceful, so the pods on the way out
  // terminalise exactly this population themselves. What survives that is the
  // hard-kill case, whose STORED status was already stuck before this change —
  // the read-time derivation that showed it as STALLED wrote nothing and fired
  // nothing downstream, so only the display regresses, and only until the next
  // restart inside `LOOKBACK_MS`. And a timer would cost an unfiltered
  // cross-tenant 7-day aggregation over `simulation_runs` per worker per tick,
  // unsynchronised across pods — reinstating the periodic scan ADR-073 exists
  // to retire, to cover one deploy's worth of exposure.
  const sharedClickHouseClient = getSharedClickHouseClient();
  if (sharedClickHouseClient) {
    const reconcilerNow = Date.now();
    void reconcileOrphanedQueuedRuns({
      findCandidates: () =>
        findQueuedRunCandidates({
          client: sharedClickHouseClient,
          lookbackMs: LOOKBACK_MS,
          now: reconcilerNow,
          orphanThresholdMs: ORPHAN_QUEUED_THRESHOLD_MS,
        }),
      emitFailure: (candidate) =>
        deps.failureEmitter.ensureFailureEventsEmitted({
          projectId: candidate.projectId,
          scenarioId: candidate.scenarioId,
          setId: candidate.setId,
          batchRunId: candidate.batchRunId,
          scenarioRunId: candidate.scenarioRunId,
          error:
            "Reconciled: orphaned QUEUED run with no live worker (worker restart/crash)",
        }),
      now: reconcilerNow,
      thresholdMs: ORPHAN_QUEUED_THRESHOLD_MS,
    }).catch((err) => logger.warn({ err }, "orphan reconciler failed"));
  }

  void reconcileOrphanedRunsOnBoot({
    failureEmitter: deps.failureEmitter,
  }).catch((err: unknown) =>
    logger.error({ err }, "Orphaned-run reconciliation failed on boot"),
  );

  return {
    close: async () => {
      // Kill the children this worker holds, then wait — within a bounded
      // budget — for each of their runs to be recorded as finished. The armed
      // deadline is what covers a hard kill and anything the budget does not
      // reach; it is NOT a reason to skip this, because on the common path
      // (a deploy) it means half an hour of a run displaying as live when the
      // worker knew it was dead the moment it was asked to stop.
      await settleInFlightRuns({ pool, deps });
      await unsubscribe().catch((err: unknown) =>
        logger.warn({ err }, "Error closing cancellation subscriber"),
      );
    },
  };
}
