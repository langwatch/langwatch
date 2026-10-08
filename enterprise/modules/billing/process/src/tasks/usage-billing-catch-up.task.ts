// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { createLogger, type Logger } from "@langwatch/observability";
import { ORGANIZATION_ID_PAGE_LIMIT, type OrganizationApi } from "@langwatch/organization-contract";
import { Task } from "@langwatch/task";

import type { BillingModule } from "../app/billing.app.ts";

const defaultLogger: Logger = createLogger("langwatch:task:usage-billing-catch-up");

type UsageBillingCatchUpPeers = Readonly<{
  organizations: Pick<OrganizationApi, "listAllIds">;
  billing: Pick<BillingModule, "catchUpUsageBilling">;
  logger?: Pick<Logger, "info">;
}>;

/**
 * Records whether the meter bills every organization, billed or not, as a catch-up fact the
 * Instant Evals judge folds (ADR-174 decision 17). Safe to re-run: each run is a newer read.
 * Run it first after the rollout, then the spend catch-up, then `backfill-project-created`.
 * `--dry-run` reads billing and logs the counts it would record, recording nothing.
 */
export class UsageBillingCatchUpTask extends Task {
  readonly name = "usage-billing-catch-up";
  readonly description =
    "Records whether the meter bills each organization, for the Instant Evals judge. Safe to re-run.";

  private constructor(private readonly peers: UsageBillingCatchUpPeers) {
    super();
  }

  static create(peers: UsageBillingCatchUpPeers): UsageBillingCatchUpTask {
    return new UsageBillingCatchUpTask(peers);
  }

  async run({ args, signal }: { args: readonly string[]; signal: AbortSignal }): Promise<void> {
    const isDryRun = args.includes("--dry-run");
    let organizations = 0;
    let usageBilled = 0;
    let after: string | undefined;
    do {
      const page = await this.peers.organizations.listAllIds({
        after,
        limit: ORGANIZATION_ID_PAGE_LIMIT,
      });
      for (const organizationId of page.ids) {
        signal.throwIfAborted();
        const answer = await this.peers.billing.catchUpUsageBilling({ organizationId, isDryRun });
        organizations += 1;
        if (answer.usageBilled) usageBilled += 1;
      }
      after = page.next ?? undefined;
    } while (after !== undefined);
    (this.peers.logger ?? defaultLogger).info(
      { isDryRun, organizations, usageBilled, notUsageBilled: organizations - usageBilled },
      isDryRun
        ? "usage-billing catch-up dry run: nothing recorded"
        : "usage-billing catch-up recorded every organization",
    );
  }
}
