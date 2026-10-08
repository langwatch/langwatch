import { createLogger, type Logger } from "@langwatch/observability";
import type { OrganizationApi } from "@langwatch/organization-contract";
import { Task } from "@langwatch/task";

import type { InstantEvalModule } from "../app/instant-eval.app.ts";

const defaultLogger: Logger = createLogger("langwatch:task:instant-eval-judge-spend-catch-up");

type SpendCatchUpPeers = Readonly<{
  organizations: Pick<OrganizationApi, "findAllIds">;
  instantEvals: Pick<InstantEvalModule, "copyLedgerSpendToJudge">;
  logger?: Pick<Logger, "info">;
}>;

/**
 * Copies every organization's confirmed Instant Evals ledger rows into the judge's own spend by
 * request id, skipping requests it holds (ADR-174 decision 17). Safe to re-run at any time.
 * Run it after the usage-billing catch-up, and again after any rollback and redeploy.
 * `--dry-run` reads the ledger and logs its rows and spend, copying nothing.
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

  async run({ args, signal }: { args: readonly string[]; signal: AbortSignal }): Promise<void> {
    const isDryRun = args.includes("--dry-run");
    const totals = { organizations: 0, ledgerRows: 0, ledgerNanoUsd: 0, copied: 0, alreadyHeld: 0 };
    for (const organizationId of await this.peers.organizations.findAllIds()) {
      signal.throwIfAborted();
      const caughtUp = await this.peers.instantEvals.copyLedgerSpendToJudge({
        organizationId,
        signal,
        isDryRun,
      });
      totals.organizations += 1;
      totals.ledgerRows += caughtUp.ledgerRows;
      totals.ledgerNanoUsd += caughtUp.ledgerNanoUsd;
      totals.copied += caughtUp.copied;
      totals.alreadyHeld += caughtUp.alreadyHeld;
    }
    (this.peers.logger ?? defaultLogger).info(
      { isDryRun, ...totals },
      isDryRun
        ? "Instant Evals spend catch-up dry run: nothing copied"
        : "Instant Evals spend catch-up finished",
    );
  }
}
