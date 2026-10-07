// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { createLogger } from "@langwatch/observability";
import type { OrganizationApi } from "@langwatch/organization-contract";
import { Task } from "@langwatch/task";

import type { BillingModule } from "../app/billing.app.ts";

const logger = createLogger("langwatch:task:usage-billing-catch-up");

type UsageBillingCatchUpPeers = Readonly<{
  organizations: Pick<OrganizationApi, "findAllIds">;
  billing: Pick<BillingModule, "catchUpUsageBilling">;
}>;

/**
 * Records whether the meter bills every organization, billed or not, as a catch-up fact the
 * Instant Evals judge folds (ADR-174 decision 17). Safe to re-run: each run is a newer read.
 * Run it first after the rollout, then the spend catch-up, then `backfill-project-created`.
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

  async run({ signal }: { args: readonly string[]; signal: AbortSignal }): Promise<void> {
    let recorded = 0;
    for (const organizationId of await this.peers.organizations.findAllIds()) {
      signal.throwIfAborted();
      await this.peers.billing.catchUpUsageBilling({ organizationId });
      recorded += 1;
    }
    logger.info({ recorded }, "usage-billing catch-up recorded every organization");
  }
}
