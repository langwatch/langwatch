/**
 * Review queue for a fan-out batch: what the reviewer sees, and what their
 * approve/reject decisions do.
 *
 * See specs/scenarios/adjacent-scenario-review.feature.
 */

import type {
  FanOutBatch,
  FanOutVariant,
  FanOutVariantStatus,
} from "@prisma/client";
import {
  FanOutBatchNotFoundError,
  FanOutVariantNotInBatchError,
} from "~/server/scenarios/fan-out/errors";
import type { FanOutRepository } from "~/server/scenarios/fan-out/fan-out.repository";
import type { ScenarioRepository } from "~/server/scenarios/scenario.repository";

/**
 * A variant with the scenario it generated. The reviewer is approving the
 * scenario, not the lens label, so the thing being decided on travels with the
 * decision rather than being a second round trip the drawer never made.
 */
export type ReviewableVariant = FanOutVariant & {
  scenario: {
    id: string;
    name: string;
    situation: string;
    criteria: string[];
  } | null;
};

export type ReviewableBatch = FanOutBatch & {
  variants: ReviewableVariant[];
};

export type VariantDecision = {
  variantId: string;
  decision: "approve" | "reject";
};

export class FanOutReviewService {
  constructor(
    private readonly fanOutRepository: FanOutRepository,
    private readonly scenarioRepository: ScenarioRepository,
  ) {}

  static create(params: {
    fanOutRepository: FanOutRepository;
    scenarioRepository: ScenarioRepository;
  }): FanOutReviewService {
    return new FanOutReviewService(
      params.fanOutRepository,
      params.scenarioRepository,
    );
  }

  /** The batch plus the generated scenario behind each variant. */
  async getBatchForReview(params: {
    projectId: string;
    batchId: string;
  }): Promise<ReviewableBatch> {
    const batch = await this.fanOutRepository.findBatchById({
      id: params.batchId,
      projectId: params.projectId,
    });
    if (!batch) {
      throw new FanOutBatchNotFoundError({ meta: { batchId: params.batchId } });
    }

    const scenarios = await this.scenarioRepository.findManyDetailsByIds({
      ids: batch.variants.map((variant) => variant.scenarioId),
      projectId: params.projectId,
    });
    const scenarioById = new Map(
      scenarios.map((scenario) => [scenario.id, scenario]),
    );

    return {
      ...batch,
      variants: batch.variants.map((variant) => ({
        ...variant,
        scenario: scenarioById.get(variant.scenarioId) ?? null,
      })),
    };
  }

  /**
   * Applies a whole set of approve/reject decisions.
   *
   * The batch is resolved inside the project first, and every variant read and
   * write is scoped to that batch: FanOutVariant carries no projectId of its
   * own, so an unscoped write on a caller-supplied variant id would reach
   * another tenant's rows.
   */
  async decide(params: {
    projectId: string;
    batchId: string;
    decisions: VariantDecision[];
    decidedById: string | null;
  }): Promise<{ updated: FanOutVariant[] }> {
    const batch = await this.fanOutRepository.findBatchById({
      id: params.batchId,
      projectId: params.projectId,
    });
    if (!batch) {
      throw new FanOutBatchNotFoundError({ meta: { batchId: params.batchId } });
    }

    const updated = await this.fanOutRepository.applyDecisions({
      batchId: batch.id,
      projectId: params.projectId,
      decisions: params.decisions.map(({ variantId, decision }) => ({
        variantId,
        status: (decision === "approve"
          ? "APPROVED"
          : "REJECTED") satisfies FanOutVariantStatus,
      })),
      decidedById: params.decidedById,
    });

    if (!updated) {
      throw new FanOutVariantNotInBatchError({
        meta: { batchId: params.batchId },
      });
    }

    return { updated };
  }
}
