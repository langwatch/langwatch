/**
 * Where a judged query or run reports what it spent: one record per query and
 * one per run, on the gateway spend spine, so the same fold, the same budget
 * debits and the same monthly meter see it. @see specs/instant-evals/instant-eval-billing.feature
 */

import type { InstantEvalPricing } from "@langwatch/instant-eval-contract";
import { createLogger } from "@langwatch/observability";

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
  reportBillingMonth?(input: { organizationId: string; occurredAt: Date }): Promise<void>;
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

  /**
   * The dispatch is awaited and a failure is raised: for a run the caller is the finish intent,
   * which retries onto the same request id; for a query the caller logs and moves on, because a
   * lost ledger row is never a reason to refuse an answer already paid for.
   */
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
  async #nudgeBilling(input: { organizationId: string; occurredAt: Date }): Promise<void> {
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
