import type { BillingPricingModel } from "@langwatch/enterprise-billing-contract";
import { createLogger } from "@langwatch/observability";
import { ORGANIZATION_ID_PAGE_LIMIT } from "@langwatch/organization-contract";
import { Task } from "@langwatch/task";

import type { BillingAccountFactsRepository } from "../repositories/billing-account-facts.repository.ts";
import type { BillingSubscriptionRepository } from "../repositories/subscription.repository.ts";

const logger = createLogger("langwatch:task:tiered-free-to-seat-event");

/** The reads this migration makes: organisation ids through organization's share (C2 B). */
export type TieredFreeToSeatEventMigrationPeers = Readonly<{
  organizations: Pick<BillingAccountFactsRepository, "listIds" | "findPricingModel">;
  subscriptions: Pick<BillingSubscriptionRepository, "hasAnyForOrganization">;
}>;

/** Where the move is recorded: billing's fact, which organization applies to its row (R42). */
export type TieredFreeToSeatEventMigrationFacts = {
  pricingModelChanged(input: {
    organizationId: string;
    pricingModel: BillingPricingModel;
  }): Promise<void>;
};

export type TieredFreeToSeatEventMigrationOutcome = {
  found: number;
  updated: number;
};

/**
 * Moves every TIERED-pricing organization with no subscription at all onto SEAT_EVENT by
 * recording a fact per organisation. `--execute` is required to record; without it this only
 * lists the organizations that would move.
 */
export async function runTieredFreeToSeatEventMigration({
  peers,
  facts,
  execute,
  pageSize = ORGANIZATION_ID_PAGE_LIMIT,
}: {
  peers: TieredFreeToSeatEventMigrationPeers;
  facts: TieredFreeToSeatEventMigrationFacts;
  execute: boolean;
  pageSize?: number;
}): Promise<TieredFreeToSeatEventMigrationOutcome> {
  logger.info(
    { execute },
    `Migrate TIERED free-plan orgs to SEAT_EVENT (${execute ? "EXECUTE" : "DRY RUN"})`,
  );

  let found = 0;
  let updated = 0;
  let after: string | undefined;
  do {
    const page = await peers.organizations.listIds({ after, limit: pageSize });
    for (const organizationId of page.ids) {
      if ((await peers.organizations.findPricingModel(organizationId)) !== "TIERED") continue;
      if (await peers.subscriptions.hasAnyForOrganization(organizationId)) continue;
      found += 1;
      logger.info({ organizationId }, "Found an organization to move");
      if (!execute) continue;
      await facts.pricingModelChanged({ organizationId, pricingModel: "SEAT_EVENT" });
      updated += 1;
    }
    after = page.next ?? undefined;
  } while (after !== undefined);

  if (!execute && found > 0) {
    logger.info("This is a dry run. Re-run with --execute to apply changes.");
  }
  logger.info({ count: updated }, `Recorded ${updated} organization(s) moving to SEAT_EVENT.`);
  return { found, updated };
}

/**
 * The task-launcher entry — `pnpm --filter @langwatch/tasks task
 * tiered-free-to-seat-event -- --execute`.
 */
export class TieredFreeToSeatEventMigrateTask extends Task {
  readonly name = "tiered-free-to-seat-event";
  readonly description =
    "Moves TIERED-pricing organizations with no subscription onto SEAT_EVENT. Pass --execute to record.";

  private constructor(
    private readonly deps: {
      peers: TieredFreeToSeatEventMigrationPeers;
      facts: TieredFreeToSeatEventMigrationFacts;
    },
  ) {
    super();
  }

  static create(deps: {
    peers: TieredFreeToSeatEventMigrationPeers;
    facts: TieredFreeToSeatEventMigrationFacts;
  }): TieredFreeToSeatEventMigrateTask {
    return new TieredFreeToSeatEventMigrateTask(deps);
  }

  async run({ args }: { args: readonly string[]; signal: AbortSignal }): Promise<void> {
    await runTieredFreeToSeatEventMigration({
      peers: this.deps.peers,
      facts: this.deps.facts,
      execute: args.includes("--execute"),
    });
  }
}
