/**
 * The spend recorder that puts a judgement on the gateway spend spine.
 *
 * One confirmed outcome per query or run, dispatched through the spend
 * pipeline's own `confirmSpend` command, so the same fold that writes a
 * gateway request's row writes this one, the same process manager debits the
 * project's and organization's budgets, and the same billing meter reads it
 * back at the end of the month.
 *
 * The dispatch is awaited and a failure is raised. For a run the caller is
 * the finish intent, which the outbox retries, and the outcome's request id is
 * the run's own, so the retry lands on the same event rather than a second
 * one. For a synchronous query the caller logs and moves on, because the
 * judgements were made and a lost ledger row is an accounting problem to find
 * in the logs, never a reason to refuse an answer already paid for.
 *
 * After the spend lands, the organization's monthly billing report is nudged
 * so a month whose last judgement is not followed by a trace still reports.
 * Best effort: the report is also dispatched by every billable event and by
 * the grace window at the start of the next month.
 *
 * @see ./instant-eval-spend.outcome.ts
 * @see ../../../../../../specs/instant-evals/instant-eval-billing.feature
 */

import { createLogger } from "@langwatch/observability";

import type { ConfirmSpendCommandData } from "~/server/event-sourcing/pipelines/gateway-spend-processing/schemas/commands";
import type { InstantEvalPricing } from "../classifier/classifier";
import type {
  InstantEvalSpendRecord,
  InstantEvalSpendRecorder,
} from "../instant-eval-spend.recorder";
import {
  instantEvalSpendOutcome,
  instantEvalSpendRequestId,
} from "./instant-eval-spend.outcome";

const logger = createLogger("langwatch:instant-evals:spend-recorder");

/** Who a project's spend is billed against. */
export interface InstantEvalSpendAttribution {
  readonly organizationId: string;
  readonly teamId: string;
}

export interface SpendPipelineInstantEvalSpendRecorderDependencies {
  /** The project's organization and team, or null for a project that has none. */
  readonly attribution: (
    projectId: string,
  ) => Promise<InstantEvalSpendAttribution | null>;
  /** The spend pipeline's `confirmSpend` command. */
  readonly dispatch: (data: ConfirmSpendCommandData) => Promise<unknown>;
  /** Asks the billing pipeline to report the organization's month. Optional:
   *  a deployment that does not bill has no meter to nudge. */
  readonly reportBilling?: (args: {
    organizationId: string;
    occurredAt: Date;
  }) => Promise<void>;
  readonly pricing?: InstantEvalPricing;
}

export class SpendPipelineInstantEvalSpendRecorder
  implements InstantEvalSpendRecorder
{
  constructor(
    private readonly deps: SpendPipelineInstantEvalSpendRecorderDependencies,
  ) {}

  async recordSpend(record: InstantEvalSpendRecord): Promise<void> {
    const attribution = await this.deps.attribution(record.projectId);
    if (!attribution) {
      // A project with no organization cannot be billed, and the spine
      // refuses an outcome with an empty organization for the same reason.
      // Nothing to retry here: the project row itself is what is missing.
      logger.error(
        { projectId: record.projectId, runId: record.runId ?? null },
        "Instant Eval spend not recorded: the project has no organization",
      );
      return;
    }

    const requestId = instantEvalSpendRequestId({
      ...(record.runId ? { runId: record.runId } : {}),
    });
    await this.deps.dispatch(
      instantEvalSpendOutcome({
        input: {
          projectId: record.projectId,
          organizationId: attribution.organizationId,
          teamId: attribution.teamId,
          ...(record.runId ? { runId: record.runId } : {}),
          inputTokens: record.inputTokens,
          requests: record.requests,
          costUsd: record.costUsd,
          priceUsd: record.priceUsd,
          occurredAt: record.occurredAt,
        },
        requestId,
        ...(this.deps.pricing ? { pricing: this.deps.pricing } : {}),
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
      "Instant Eval spend recorded on the gateway spend pipeline",
    );

    await this.nudgeBilling({
      organizationId: attribution.organizationId,
      occurredAt: record.occurredAt,
    });
  }

  private async nudgeBilling(args: {
    organizationId: string;
    occurredAt: Date;
  }): Promise<void> {
    if (!this.deps.reportBilling) return;
    try {
      await this.deps.reportBilling(args);
    } catch (error) {
      logger.warn(
        { organizationId: args.organizationId, error },
        "Instant Eval spend recorded, but the billing report could not be dispatched",
      );
    }
  }
}
