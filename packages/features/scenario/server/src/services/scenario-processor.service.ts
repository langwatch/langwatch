import type {
  ScenarioExecutionPrefetchResult,
  ScenarioExecutionService,
  ScenarioExecutionResult,
} from "@langwatch/scenario-contract";
import { createContextFromJobData, runWithContext } from "@langwatch/observability/context";
import { createLogger, type Logger } from "@langwatch/observability";
import type { CancellationSubscriberPort } from "../ports/cancellation-channel.port";
import { ScenarioExecutionRunnerPort } from "../ports/scenario-execution-runner.port";
import type { ScenarioProcessorServiceMetricsPort } from "../ports/scenario-processor-metrics.port";
import type {
  ScenarioChildBootstrapPort,
  ScenarioChildExecutionSession,
} from "../ports/scenario-child-bootstrap.port";
import { isCustomerActionablePrefetchFailure } from "../rules/scenario-prefetch-failure.rules";
import type {
  ExecutionJobData,
  ScenarioExecutionPoolService,
} from "./scenario-execution-pool.service";

const logger = createLogger("langwatch:scenarios:processor");

export class ScenarioProcessorService extends ScenarioExecutionRunnerPort {
  static create(options: {
    execution: ScenarioExecutionService;
    pool: ScenarioExecutionPoolService;
    cancellations: CancellationSubscriberPort;
    childProcesses: ScenarioChildBootstrapPort;
    metrics: ScenarioProcessorServiceMetricsPort;
  }): ScenarioProcessorService {
    return new ScenarioProcessorService(options);
  }

  private constructor(
    private readonly options: {
      execution: ScenarioExecutionService;
      pool: ScenarioExecutionPoolService;
      cancellations: CancellationSubscriberPort;
      childProcesses: ScenarioChildBootstrapPort;
      metrics: ScenarioProcessorServiceMetricsPort;
    },
  ) {
    super();
  }

  /**
   * A prefetch refusal the customer's own configuration caused is logged below
   * error, naming the reason; anything else stays at error, where a real fault
   * belongs. Static so the classification can be exercised on its own.
   */
  static logPrefetchFailure({
    jobLogger,
    prefetchResult,
  }: {
    jobLogger: Pick<Logger, "warn" | "error">;
    prefetchResult: Extract<ScenarioExecutionPrefetchResult, { success: false }>;
  }): void {
    const customerActionable = isCustomerActionablePrefetchFailure(prefetchResult.reason);
    jobLogger[customerActionable ? "warn" : "error"](
      { error: prefetchResult.error, reason: prefetchResult.reason, phase: "prefetch" },
      customerActionable
        ? "Scenario prefetch blocked by project configuration; failing the run with its remediation message"
        : "Failed to prefetch scenario data",
    );
  }

  async start(): Promise<{ close: () => Promise<void> }> {
    this.options.pool.connect(this);
    const unsubscribe = await this.options.cancellations.subscribe((message) => {
      const child = this.options.pool.runningChildren.get(message.scenarioRunId);
      if (child) {
        logger.info(
          { scenarioRunId: message.scenarioRunId, pid: child.pid },
          "Killing child process via cancellation broadcast",
        );
        child.kill("SIGTERM");
      }

      this.options.pool.markCancelled(message.scenarioRunId);
    });

    return {
      close: async () => {
        await this.drain();
        await unsubscribe().catch((error: unknown) => {
          logger.warn({ error }, "Error closing cancellation subscriber");
        });
      },
    };
  }

  async execute(jobData: ExecutionJobData): Promise<void> {
    const requestContext = createContextFromJobData({
      projectId: jobData.projectId,
    });

    await runWithContext(requestContext, async () => {
      await this.executeInContext(jobData);
    });
  }

  skipCancelled(jobData: ExecutionJobData): void {
    logger.info(
      { scenarioRunId: jobData.scenarioRunId },
      "Dispatching terminal event for skipped cancelled run",
    );
    void this.handleCancelled(jobData, "Cancelled before execution started").catch(
      (error: unknown) => {
        logger.error(
          { error, scenarioRunId: jobData.scenarioRunId },
          "Failed to finish skipped cancelled run",
        );
      },
    );
  }

  async drain(): Promise<void> {
    const inFlight = this.options.pool.inFlightJobs;
    if (inFlight.length > 0) {
      logger.info(
        { count: inFlight.length },
        "Emitting terminal events for in-flight Scenario runs",
      );
      await Promise.all(
        inFlight.map(async (jobData) => {
          try {
            if (this.options.pool.wasCancelled(jobData.scenarioRunId)) {
              await this.handleCancelled(jobData, "Cancelled before execution started");

              return;
            }

            await this.handleFailed(
              jobData,
              "Worker restarting — scenario run terminated before completion",
            );
          } catch (error) {
            logger.warn(
              { error, scenarioRunId: jobData.scenarioRunId },
              "Failed to finish in-flight Scenario run",
            );
          }
        }),
      );
    }

    this.options.pool.drain();
  }

  async handleFailed(jobData: ExecutionJobData, error: string | undefined): Promise<void> {
    await this.options.execution.finishUnsuccessfulRun({
      projectId: jobData.projectId,
      scenarioId: jobData.scenarioId,
      setId: jobData.setId,
      batchRunId: jobData.batchRunId,
      scenarioRunId: jobData.scenarioRunId,
      error,
      target: jobData.target,
    });
  }

  private async executeInContext(jobData: ExecutionJobData): Promise<void> {
    const startedAt = Date.now();
    const jobLogger = logger.child({
      scenarioId: jobData.scenarioId,
      projectId: jobData.projectId,
      batchRunId: jobData.batchRunId,
      setId: jobData.setId,
      scenarioRunId: jobData.scenarioRunId,
    });
    this.options.metrics.started();
    jobLogger.info("Processing scenario job");

    const preparation = this.options.execution.prepare({
      context: {
        projectId: jobData.projectId,
        scenarioId: jobData.scenarioId,
        setId: jobData.setId,
        batchRunId: jobData.batchRunId,
        scenarioRunId: jobData.scenarioRunId,
        parameters: jobData.parameters,
        secretParameters: jobData.secretParameters,
      },
      target: jobData.target,
    });
    const childEnvironment = await preparation.childEnvironment;
    let childSession: ScenarioChildExecutionSession | null = null;
    let childStartedAt: number | null = null;
    if (childEnvironment && !this.options.pool.wasCancelled(jobData.scenarioRunId)) {
      childStartedAt = Date.now();
      childSession = this.options.childProcesses.start({
        jobData,
        environment: childEnvironment,
      });
    }

    let prefetch: ScenarioExecutionPrefetchResult;
    try {
      prefetch = await preparation.result;
    } catch (error) {
      await this.releaseChild({ childSession, scenarioRunId: jobData.scenarioRunId });

      throw error;
    }

    if (this.options.pool.wasCancelled(jobData.scenarioRunId)) {
      await this.releaseChild({ childSession, scenarioRunId: jobData.scenarioRunId });
      await this.handleCancelled(jobData, "Cancelled before execution started");

      return;
    }

    if (!prefetch.success) {
      await this.releaseChild({ childSession, scenarioRunId: jobData.scenarioRunId });
      ScenarioProcessorService.logPrefetchFailure({ jobLogger, prefetchResult: prefetch });
      await this.handleFailed(jobData, prefetch.error);

      return;
    }

    if (!childSession) {
      childStartedAt = Date.now();
      childSession = this.options.childProcesses.start({
        jobData,
        environment: {
          labels: prefetch.data.scenario.labels,
          telemetry: prefetch.telemetry,
        },
      });
    }

    const result = await childSession.execute({
      ...prefetch.data,
      scenarioRunId: jobData.scenarioRunId,
    });
    await this.finishExecution({
      jobData,
      result,
      startedAt,
      childStartedAt: childStartedAt ?? startedAt,
      jobLogger,
    });
  }

  /**
   * Releases whatever this run is holding. A child session deregisters itself as it aborts; without
   * one, the pool is still holding a registration that nothing else will release.
   */
  private async releaseChild({
    childSession,
    scenarioRunId,
  }: {
    childSession: ScenarioChildExecutionSession | null;
    scenarioRunId: string;
  }): Promise<void> {
    if (childSession) {
      await childSession.abort();

      return;
    }

    this.options.pool.deregisterChild(scenarioRunId);
  }

  private async finishExecution(input: {
    jobData: ExecutionJobData;
    result: ScenarioExecutionResult;
    startedAt: number;
    childStartedAt: number;
    jobLogger: Logger;
  }): Promise<void> {
    const { jobData, result, startedAt, childStartedAt, jobLogger } = input;
    const durationMs = Date.now() - startedAt;
    const childDurationMs = Date.now() - childStartedAt;

    if (result.success) {
      this.options.metrics.completed(durationMs);
      await this.handleSucceeded({ jobData, result, jobLogger });
      jobLogger.info({ success: true, durationMs, childDurationMs }, "Scenario job completed");

      return;
    }

    if (result.cancelled) {
      await this.handleCancelled(jobData, result.error);

      return;
    }

    this.options.metrics.failed();
    jobLogger.warn(
      { success: false, error: result.error, durationMs, childDurationMs },
      "Scenario job completed with failure",
    );
    await this.handleFailed(jobData, result.error);
  }

  /**
   * What a job that ran to the end records: the connected agent instance the
   * child named, when one did. A run served by no connected agent names none
   * and records nothing, and a record that cannot be written never fails the
   * job that already succeeded.
   */
  async handleSucceeded(input: {
    jobData: ExecutionJobData;
    result: ScenarioExecutionResult;
    jobLogger?: Logger;
  }): Promise<void> {
    const agentInstance = input.result.agentInstance;
    if (!agentInstance) return;
    try {
      await this.options.execution.recordAgentInstance({
        projectId: input.jobData.projectId,
        scenarioRunId: input.jobData.scenarioRunId,
        agentInstance,
      });
    } catch (error) {
      (input.jobLogger ?? logger).warn(
        { err: error, scenarioRunId: input.jobData.scenarioRunId },
        "Could not record the agent instance that served the run",
      );
    }
  }

  private async handleCancelled(
    jobData: ExecutionJobData,
    error: string | undefined,
  ): Promise<void> {
    await this.options.execution.finishUnsuccessfulRun({
      projectId: jobData.projectId,
      scenarioId: jobData.scenarioId,
      setId: jobData.setId,
      batchRunId: jobData.batchRunId,
      scenarioRunId: jobData.scenarioRunId,
      error: error ?? "Cancelled by user",
      cancelled: true,
    });
  }
}
