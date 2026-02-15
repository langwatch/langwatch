/**
 * Dispatch functions for dual-writing experiment run events to ClickHouse
 * via the event-sourcing pipeline.
 *
 * Feature flags (on Project model):
 *   - featureEventSourcingEvaluationIngestion — write path: when enabled,
 *     experiment run commands are dispatched to ClickHouse alongside the
 *     existing Elasticsearch writes.
 *   - featureClickHouseDataSourceEvaluations — read path: when enabled,
 *     queries are routed to ClickHouse instead of Elasticsearch.
 */
import type { PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "~/server/db";
import { getExperimentRunProcessingPipeline } from "~/server/event-sourcing/runtime/eventSourcing";
import type {
  CompleteExperimentRunCommandData,
  RecordEvaluatorResultCommandData,
  RecordTargetResultCommandData,
  StartExperimentRunCommandData,
} from "~/server/event-sourcing/pipelines/experiment-run-processing/schemas/commands";
import { createLogger } from "~/utils/logger/server";

const logger = createLogger("evaluations-v3:dispatch");

type PipelineFactory = typeof getExperimentRunProcessingPipeline;

/**
 * Dispatches experiment run events to ClickHouse via the event-sourcing
 * pipeline. Each method is fire-and-forget — errors are logged but never
 * propagated.
 */
export class ExperimentRunDispatcher {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly getPipeline: PipelineFactory,
  ) {}

  /**
   * Static factory with default dependencies (module-level prisma +
   * default pipeline factory).
   */
  static create(
    prisma: PrismaClient = defaultPrisma,
    getPipeline: PipelineFactory = getExperimentRunProcessingPipeline,
  ): ExperimentRunDispatcher {
    return new ExperimentRunDispatcher(prisma, getPipeline);
  }

  /**
   * Checks if ClickHouse dual-write is enabled for batch evaluations.
   * Uses the featureEventSourcingEvaluationIngestion project flag.
   */
  async isClickHouseEnabled(projectId: string): Promise<boolean> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { featureEventSourcingEvaluationIngestion: true },
    });
    return project?.featureEventSourcingEvaluationIngestion === true;
  }

  /**
   * Dispatches start experiment run command to ClickHouse via event sourcing.
   * Fire-and-forget - errors are logged but don't affect the main execution.
   */
  async startRun(payload: StartExperimentRunCommandData): Promise<void> {
    try {
      const pipeline = this.getPipeline();
      await pipeline.commands.startExperimentRun.send({
        ...payload,
        occurredAt: payload.occurredAt,
      });
    } catch (error) {
      logger.warn(
        { error, runId: payload.runId },
        "Failed to dispatch start experiment run event to ClickHouse",
      );
    }
  }

  /**
   * Dispatches record target result command to ClickHouse via event sourcing.
   * Fire-and-forget - errors are logged but don't affect the main execution.
   */
  async recordTargetResult(
    payload: RecordTargetResultCommandData,
  ): Promise<void> {
    try {
      const pipeline = this.getPipeline();
      await pipeline.commands.recordTargetResult.send({
        ...payload,
        occurredAt: payload.occurredAt,
      });
    } catch (error) {
      logger.warn(
        { error, runId: payload.runId },
        "Failed to dispatch record target result event to ClickHouse",
      );
    }
  }

  /**
   * Dispatches record evaluator result command to ClickHouse via event sourcing.
   * Fire-and-forget - errors are logged but don't affect the main execution.
   */
  async recordEvaluatorResult(
    payload: RecordEvaluatorResultCommandData,
  ): Promise<void> {
    try {
      const pipeline = this.getPipeline();
      await pipeline.commands.recordEvaluatorResult.send({
        ...payload,
        occurredAt: payload.occurredAt,
      });
    } catch (error) {
      logger.warn(
        { error, runId: payload.runId },
        "Failed to dispatch record evaluator result event to ClickHouse",
      );
    }
  }

  /**
   * Dispatches complete experiment run command to ClickHouse via event sourcing.
   * Fire-and-forget - errors are logged but don't affect the main execution.
   */
  async completeRun(
    payload: CompleteExperimentRunCommandData,
  ): Promise<void> {
    try {
      const pipeline = this.getPipeline();
      await pipeline.commands.completeExperimentRun.send({
        ...payload,
        occurredAt: payload.occurredAt,
      });
    } catch (error) {
      logger.warn(
        { error, runId: payload.runId },
        "Failed to dispatch complete experiment run event to ClickHouse",
      );
    }
  }
}
