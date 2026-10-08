import { createLogger, type Logger } from "@langwatch/observability";
import { ORGANIZATION_ID_PAGE_LIMIT, type OrganizationApi } from "@langwatch/organization-contract";
import { Task } from "@langwatch/task";

import type { InstantEvalModule } from "../app/instant-eval.app.ts";

const defaultLogger: Logger = createLogger("langwatch:task:instant-eval-judge-spend-catch-up");

type SpendCatchUpPeers = Readonly<{
  organizations: Pick<OrganizationApi, "listAllIds">;
  instantEvals: Pick<InstantEvalModule, "copyLedgerSpendToJudge">;
  logger?: Pick<Logger, "info">;
}>;

/**
 * Copies every organization's confirmed Instant Evals ledger rows into the judge's own spend by
 * request id, skipping requests it holds (ADR-174 decision 17). Safe to re-run at any time.
 * Run after the usage-billing catch-up and any rollback redeploy. `--dry-run` copies nothing.
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
    let after: string | undefined;
    do {
      const page = await this.peers.organizations.listAllIds({
        after,
        limit: ORGANIZATION_ID_PAGE_LIMIT,
      });
      for (const organizationId of page.ids) {
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
      after = page.next ?? undefined;
    } while (after !== undefined);
    (this.peers.logger ?? defaultLogger).info(
      { isDryRun, ...totals },
      isDryRun
        ? "Instant Evals spend catch-up dry run: nothing copied"
        : "Instant Evals spend catch-up finished",
    );
  }
}
