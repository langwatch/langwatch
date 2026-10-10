/**
 * Where a run or a judged query reports what it spent: through the Instant Evals judge, under the
 * organization this module resolves, so the judge never looks the project up (ADR-174 decision
 * 13). The judge's priced fact then writes the gateway ledger row, so nothing here writes one.
 * @see modules/instant-eval/specs/instant-eval-judge-model.feature
 */

import type { InstantEvalJudgeApi } from "@langwatch/instant-eval-judge-contract";
import { createLogger } from "@langwatch/observability";
import type { Instant } from "@langwatch/time";

import { instantEvalSpendRequestId } from "../rules/instant-eval-spend-outcome.rules.ts";

const logger = createLogger("langwatch:instant-eval:judged-spend");

/** What one run or one judged query spent on judgements. */
export interface InstantEvalJudgedSpend {
  readonly projectId: string;
  /** The run this spend belongs to; every attempt of a run records under the run's own id. */
  readonly runId?: string;
  /** Input tokens the classifier billed for. */
  readonly inputTokens: number;
  /** Classifications made, which is one per judged text. */
  readonly requests: number;
  readonly occurredAt: Instant;
}

interface InstantEvalJudgedSpendPeers {
  /** The project's organization, or undefined when it has none. */
  findOrganizationId(input: { projectId: string }): Promise<string | undefined>;
  judges: Pick<InstantEvalJudgeApi, "recordSpend">;
}

export class InstantEvalJudgedSpendService {
  private constructor(private readonly peers: InstantEvalJudgedSpendPeers) {}

  static create({ peers }: { peers: InstantEvalJudgedSpendPeers }): InstantEvalJudgedSpendService {
    return new InstantEvalJudgedSpendService(peers);
  }

  /**
   * Raised when the judge cannot store it: for a run the finish intent retries onto the same
   * request id; for a query the caller logs and moves on, since the answer was already paid for.
   */
  async recordSpend({
    projectId,
    runId,
    inputTokens,
    requests,
    occurredAt,
  }: InstantEvalJudgedSpend): Promise<void> {
    const organizationId = await this.peers.findOrganizationId({ projectId });
    if (organizationId === undefined) {
      // Nothing to retry: the project's organization itself is what is missing.
      logger.error(
        { projectId, runId: runId ?? null },
        "Instant Eval spend not recorded: the project has no organization",
      );
      return;
    }

    const requestId = instantEvalSpendRequestId(runId ? { runId } : {});
    await this.peers.judges.recordSpend({
      organizationId,
      projectId,
      requestId,
      inputTokens,
      requests,
      ...(runId ? { runId } : {}),
      occurredAt: occurredAt.epochMilliseconds,
    });
    logger.debug(
      { projectId, runId: runId ?? null, requestId, inputTokens },
      "Instant Eval spend recorded through the Instant Evals judge",
    );
  }
}
