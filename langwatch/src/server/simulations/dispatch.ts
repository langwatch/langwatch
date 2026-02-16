/**
 * Dispatch functions for dual-writing simulation events to ClickHouse
 * via the event-sourcing pipeline.
 *
 * Feature flags (on Project model):
 *   - featureEventSourcingSimulationIngestion — write path: when enabled,
 *     simulation commands are dispatched to ClickHouse alongside the
 *     existing Elasticsearch writes.
 *   - featureClickHouseDataSourceSimulations — read path (future): when enabled,
 *     queries are routed to ClickHouse instead of Elasticsearch.
 */
import type { PrismaClient } from "@prisma/client";
import { prisma as defaultPrisma } from "~/server/db";
import { getSimulationProcessingPipeline } from "~/server/event-sourcing/runtime/eventSourcing";
import type {
  StartRunCommandData,
  MessageSnapshotCommandData,
  FinishRunCommandData,
  DeleteRunCommandData,
} from "~/server/event-sourcing/pipelines/simulation-processing/schemas/commands";
import { createLogger } from "~/utils/logger/server";

const logger = createLogger("simulations:dispatch");

type PipelineFactory = typeof getSimulationProcessingPipeline;

/**
 * Dispatches simulation events to ClickHouse via the event-sourcing
 * pipeline. Each method is fire-and-forget — errors are logged but never
 * propagated.
 */
export class SimulationDispatcher {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly getPipeline: PipelineFactory,
  ) {}

  static create(
    prisma: PrismaClient = defaultPrisma,
    getPipeline: PipelineFactory = getSimulationProcessingPipeline,
  ): SimulationDispatcher {
    return new SimulationDispatcher(prisma, getPipeline);
  }

  /**
   * Checks if ClickHouse dual-write is enabled for simulations.
   * Uses the featureEventSourcingSimulationIngestion project flag.
   */
  async isClickHouseEnabled(projectId: string): Promise<boolean> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      select: { featureEventSourcingSimulationIngestion: true },
    });
    return project?.featureEventSourcingSimulationIngestion === true;
  }

  async startRun(payload: StartRunCommandData): Promise<void> {
    try {
      const pipeline = this.getPipeline();
      await pipeline.commands.startRun.send(payload);
    } catch (error) {
      logger.warn(
        { error, scenarioRunId: payload.scenarioRunId },
        "Failed to dispatch start simulation run event to ClickHouse",
      );
    }
  }

  async messageSnapshot(payload: MessageSnapshotCommandData): Promise<void> {
    try {
      const pipeline = this.getPipeline();
      await pipeline.commands.messageSnapshot.send(payload);
    } catch (error) {
      logger.warn(
        { error, scenarioRunId: payload.scenarioRunId },
        "Failed to dispatch message snapshot event to ClickHouse",
      );
    }
  }

  async finishRun(payload: FinishRunCommandData): Promise<void> {
    try {
      const pipeline = this.getPipeline();
      await pipeline.commands.finishRun.send(payload);
    } catch (error) {
      logger.warn(
        { error, scenarioRunId: payload.scenarioRunId },
        "Failed to dispatch finish simulation run event to ClickHouse",
      );
    }
  }

  async deleteRun(payload: DeleteRunCommandData): Promise<void> {
    try {
      const pipeline = this.getPipeline();
      await pipeline.commands.deleteRun.send(payload);
    } catch (error) {
      logger.warn(
        { error, scenarioRunId: payload.scenarioRunId },
        "Failed to dispatch delete simulation run event to ClickHouse",
      );
    }
  }
}
