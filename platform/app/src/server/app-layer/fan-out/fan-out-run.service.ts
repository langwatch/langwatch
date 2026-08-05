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
import {
  FanOutBatchNotFoundError,
  FanOutBatchTargetInvalidError,
  FanOutNoApprovedVariantsError,
} from "~/server/scenarios/fan-out/errors";
import type { FanOutRepository } from "~/server/scenarios/fan-out/fan-out.repository";
import type { FanOutTarget } from "~/server/scenarios/fan-out/fan-out-generation.service";
import { generateBatchRunId } from "~/server/scenarios/scenario.ids";
import type { ScenarioRepository } from "~/server/scenarios/scenario.repository";
import { KSUID_RESOURCES } from "~/utils/constants";

const logger = createLogger("langwatch:fan-out:run");

export type FanOutRunResult = {
  batchRunId: string;
  scenarioSetId: string;
  itemCount: number;
};

const TARGET_TYPES = ["prompt", "http", "code", "workflow"] as const;

/** Narrows a batch's stored JSON target back to the shape dispatch needs. */
function asFanOutTarget(value: unknown): FanOutTarget | null {
  if (typeof value !== "object" || value === null) return null;
  const { type, referenceId } = value as Record<string, unknown>;
  if (typeof referenceId !== "string" || referenceId.length === 0) return null;
  if (!TARGET_TYPES.includes(type as (typeof TARGET_TYPES)[number])) {
    return null;
  }
  return { type: type as FanOutTarget["type"], referenceId };
}

export class FanOutRunService {
  constructor(
    private readonly queueSimulationRunCommand: (
      data: QueueRunCommandData,
    ) => Promise<void>,
    private readonly fanOutRepository: FanOutRepository,
    private readonly scenarioRepository: ScenarioRepository,
  ) {}

  static create(params: {
    queueSimulationRun: (data: QueueRunCommandData) => Promise<void>;
    fanOutRepository: FanOutRepository;
    scenarioRepository: ScenarioRepository;
  }): FanOutRunService {
    return new FanOutRunService(
      params.queueSimulationRun,
      params.fanOutRepository,
      params.scenarioRepository,
    );
  }

  /**
   * Runs a batch: resolves it inside the project, keeps only the approved
   * variants, resolves display names, dispatches, and moves the batch to
   * DISPATCHING.
   */
  async dispatchBatch(params: {
    projectId: string;
    batchId: string;
  }): Promise<FanOutRunResult> {
    const batch = await this.fanOutRepository.findBatchById({
      id: params.batchId,
      projectId: params.projectId,
    });
    if (!batch) {
      throw new FanOutBatchNotFoundError({ meta: { batchId: params.batchId } });
    }

    const approvedVariants = batch.variants.filter(
      (variant) => variant.status === "APPROVED",
    );
    if (approvedVariants.length === 0) {
      throw new FanOutNoApprovedVariantsError({
        meta: { batchId: params.batchId },
      });
    }

    const target = asFanOutTarget(batch.seedTarget);
    if (!target) {
      throw new FanOutBatchTargetInvalidError({
        meta: { batchId: params.batchId },
      });
    }

    const scenarioIds = approvedVariants.map((variant) => variant.scenarioId);
    if (batch.seedScenarioId) scenarioIds.push(batch.seedScenarioId);
    const scenarios = await this.scenarioRepository.findNamesByIds({
      ids: scenarioIds,
      projectId: params.projectId,
    });
    const names = new Map(
      scenarios.map((scenario) => [scenario.id, scenario.name]),
    );

    const result = await this.startRun({
      projectId: params.projectId,
      scenarioSetId: batch.scenarioSetId,
      seedScenarioId: batch.seedScenarioId,
      seedName: batch.seedScenarioId
        ? names.get(batch.seedScenarioId)
        : undefined,
      target,
      approvedVariants,
      variantNames: names,
    });

    await this.fanOutRepository.updateBatchStatus({
      id: batch.id,
      projectId: params.projectId,
      status: "DISPATCHING",
      batchRunId: result.batchRunId,
    });

    return result;
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

    const variantItems = params.approvedVariants.map((variant) => ({
      variantId: variant.id,
      scenarioId: variant.scenarioId,
      scenarioRunId: generate(KSUID_RESOURCES.SCENARIO_RUN).toString(),
      name: params.variantNames.get(variant.scenarioId),
    }));

    const items: Array<{
      scenarioId: string;
      scenarioRunId: string;
      name: string | undefined;
    }> = [
      ...(params.seedScenarioId
        ? [
            {
              scenarioId: params.seedScenarioId,
              scenarioRunId: generate(KSUID_RESOURCES.SCENARIO_RUN).toString(),
              name: params.seedName,
            },
          ]
        : []),
      ...variantItems,
    ];

    logger.debug(
      { projectId: params.projectId, batchRunId, itemCount: items.length },
      "Dispatching fan-out run",
    );

    // Recorded before anything is queued, because the run id is the only join
    // between a variant and its verdict: a variant whose run was dispatched
    // but whose id was never written is invisible to the blast-radius report.
    await Promise.all(
      variantItems.map((item) =>
        this.fanOutRepository.setVariantScenarioRunId({
          id: item.variantId,
          projectId: params.projectId,
          scenarioRunId: item.scenarioRunId,
        }),
      ),
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
            langwatch: {
              targetReferenceId: params.target.referenceId,
              targetType: params.target.type,
            },
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
