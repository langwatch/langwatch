import { createLogger } from "@langwatch/observability";
import type { OrganizationApi } from "@langwatch/organization-contract";
import { Task } from "@langwatch/task";

import type { InstantEvalModule } from "../app/instant-eval.app.ts";

const logger = createLogger("langwatch:task:instant-eval-judge-spend-catch-up");

type SpendCatchUpPeers = Readonly<{
  organizations: Pick<OrganizationApi, "findAllIds">;
  instantEvals: Pick<InstantEvalModule, "copyLedgerSpendToJudge">;
}>;

/**
 * Copies every organization's confirmed Instant Evals ledger rows into the judge's own spend by
 * request id, skipping requests it holds (ADR-174 decision 17). Safe to re-run at any time.
 * Run it after the usage-billing catch-up, and again after any rollback and redeploy.
 */
export class InstantEvalJudgeSpendCatchUpTask extends Task {
  readonly name = "instant-eval-judge-spend-catch-up";
  readonly description =
    "Copies Instant Evals spend from the gateway ledger into the Instant Evals judge. Safe to re-run.";

  private constructor(private readonly peers: SpendCatchUpPeers) {
    super();
  }

  static create(peers: SpendCatchUpPeers): InstantEvalJudgeSpendCatchUpTask {
    return new InstantEvalJudgeSpendCatchUpTask(peers);
  }

  async run({ signal }: { args: readonly string[]; signal: AbortSignal }): Promise<void> {
    let copied = 0;
    let alreadyHeld = 0;
    for (const organizationId of await this.peers.organizations.findAllIds()) {
      signal.throwIfAborted();
      const caughtUp = await this.peers.instantEvals.copyLedgerSpendToJudge({
        organizationId,
        signal,
      });
      copied += caughtUp.copied;
      alreadyHeld += caughtUp.alreadyHeld;
    }
    logger.info({ copied, alreadyHeld }, "Instant Evals spend catch-up finished");
  }
}
