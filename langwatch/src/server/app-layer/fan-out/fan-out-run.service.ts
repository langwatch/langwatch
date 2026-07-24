/**
 * Dispatches the APPROVED variants of a fan-out batch to run, under one
 * shared batchRunId — the same "pre-generate scenarioRunId, queue via the
 * existing event-sourcing command" shape SuiteRunService.startRun already
 * uses, so execution reuses the existing worker-pod pipeline unchanged.
 *
 * See specs/scenarios/adjacent-scenario-blast-radius.feature.
 */

import { generate } from "@langwatch/ksuid";
import { createLogger } from "@langwatch/observability";
import type { FanOutVariant } from "@prisma/client";
import type { QueueRunCommandData } from "~/server/event-sourcing/pipelines/simulation-processing/schemas/commands";
import { generateBatchRunId } from "~/server/scenarios/scenario.ids";
import { KSUID_RESOURCES } from "~/utils/constants";
import type { FanOutTarget } from "~/server/scenarios/fan-out/fan-out-generation.service";

const logger = createLogger("langwatch:fan-out:run");

export type FanOutRunResult = {
  batchRunId: string;
  scenarioSetId: string;
  itemCount: number;
};

export class FanOutRunService {
  constructor(
    private readonly queueSimulationRunCommand: (
      data: QueueRunCommandData,
    ) => Promise<void>,
  ) {}

  static create(params: {
    queueSimulationRun: (data: QueueRunCommandData) => Promise<void>;
  }): FanOutRunService {
    return new FanOutRunService(params.queueSimulationRun);
  }

  /**
   * Queues the given approved variants (plus, by default, the seed scenario
   * itself as a baseline) under one shared batchRunId.
   */
  async startRun(params: {
    projectId: string;
    scenarioSetId: string;
    seedScenarioId: string | null;
    seedName: string | undefined;
    target: FanOutTarget;
    approvedVariants: FanOutVariant[];
    variantNames: Map<string, string>;
  }): Promise<FanOutRunResult> {
    const batchRunId = generateBatchRunId();
    const now = Date.now();

    const items: Array<{ scenarioId: string; scenarioRunId: string; name: string | undefined }> = [
      ...(params.seedScenarioId
        ? [
            {
              scenarioId: params.seedScenarioId,
              scenarioRunId: generate(KSUID_RESOURCES.SCENARIO_RUN).toString(),
              name: params.seedName,
            },
          ]
        : []),
      ...params.approvedVariants.map((variant) => ({
        scenarioId: variant.scenarioId,
        scenarioRunId: generate(KSUID_RESOURCES.SCENARIO_RUN).toString(),
        name: params.variantNames.get(variant.scenarioId),
      })),
    ];

    logger.debug(
      { projectId: params.projectId, batchRunId, itemCount: items.length },
      "Dispatching fan-out run",
    );

    await Promise.allSettled(
      items.map((item) =>
        this.queueSimulationRunCommand({
          tenantId: params.projectId,
          scenarioRunId: item.scenarioRunId,
          scenarioId: item.scenarioId,
          batchRunId,
          scenarioSetId: params.scenarioSetId,
          name: item.name,
          metadata: {
            langwatch: { targetReferenceId: params.target.referenceId },
          },
          target: params.target,
          occurredAt: now,
        }),
      ),
    );

    return {
      batchRunId,
      scenarioSetId: params.scenarioSetId,
      itemCount: items.length,
    };
  }
}
