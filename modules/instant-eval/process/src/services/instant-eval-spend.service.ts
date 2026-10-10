/**
 * Where a hosted Connect call reports what it spent: on the gateway spend spine, under the
 * calling key, so the same fold, budget debits and monthly meter see it. Runs and judged queries
 * record through the Instant Evals judge instead (ADR-174 decision 13).
 * @see modules/instant-eval/specs/instant-eval-billing.feature
 */

import type { InstantEvalPricing } from "@langwatch/instant-eval-judge-contract";
import { createLogger } from "@langwatch/observability";
import type { Instant } from "@langwatch/time";

import {
  type InstantEvalPricedSpend,
  type InstantEvalSpendAttribution,
  type InstantEvalSpendRecord,
  instantEvalPricedSpend,
  instantEvalSpendRequestId,
} from "../rules/instant-eval-spend-outcome.rules.ts";

const logger = createLogger("langwatch:instant-eval:spend");

/** The peers a judgement's spend is reported through, each one operation wide. */
export interface InstantEvalSpendPeers {
  /** The project's organization and team, or undefined when it has neither. */
  findSpendAttribution(input: {
    projectId: string;
  }): Promise<InstantEvalSpendAttribution | undefined>;
  /** The spend spine, which takes the price as the caller resolved it. */
  recordPricedSpend(input: InstantEvalPricedSpend): Promise<void>;
  /**
   * Nudges the organization's monthly billing report, so a month whose last
   * judgement is not followed by a trace still reports. Absent on a
   * deployment that does not bill.
   */
  reportBillingMonth?(input: { organizationId: string; occurredAt: Instant }): Promise<void>;
}

export class InstantEvalSpendService {
  private constructor(
    private readonly peers: InstantEvalSpendPeers,
    private readonly pricing: InstantEvalPricing | undefined,
  ) {}

  static create({
    peers,
    pricing,
  }: {
    peers: InstantEvalSpendPeers;
    pricing?: InstantEvalPricing;
  }): InstantEvalSpendService {
    return new InstantEvalSpendService(peers, pricing);
  }

  /** The dispatch is awaited and a failure is raised, so the hosted caller keeps it and retries. */
  async recordSpend(record: InstantEvalSpendRecord): Promise<void> {
    const attribution = await this.peers.findSpendAttribution({ projectId: record.projectId });
    if (!attribution) {
      // Nothing to retry: the project row itself is what is missing, and the
      // spine refuses an outcome with an empty organization anyway.
      logger.error(
        { projectId: record.projectId, runId: record.runId ?? null },
        "Instant Eval spend not recorded: the project has no organization",
      );

      return;
    }

    const requestId = instantEvalSpendRequestId(record.runId ? { runId: record.runId } : {});
    await this.peers.recordPricedSpend(
      instantEvalPricedSpend({
        record,
        attribution,
        requestId,
        ...(this.pricing ? { pricing: this.pricing } : {}),
      }),
    );
    logger.debug(
      {
        projectId: record.projectId,
        runId: record.runId ?? null,
        requestId,
        inputTokens: record.inputTokens,
        priceUsd: record.priceUsd,
      },
      "Instant Eval spend recorded on the gateway spend spine",
    );

    await this.#nudgeBilling({
      organizationId: attribution.organizationId,
      occurredAt: record.occurredAt,
    });
  }

  /**
   * Best effort: the report is also dispatched by every billable event and by
   * the grace window at the start of the next month, so a failure here costs
   * the nudge rather than the spend.
   */
  async #nudgeBilling(input: { organizationId: string; occurredAt: Instant }): Promise<void> {
    if (!this.peers.reportBillingMonth) return;
    try {
      await this.peers.reportBillingMonth(input);
    } catch (error) {
      logger.warn(
        { organizationId: input.organizationId, error },
        "Instant Eval spend recorded, but the billing report could not be dispatched",
      );
    }
  }
}
