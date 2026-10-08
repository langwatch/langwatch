import { createLogger } from "@langwatch/observability";
import { Task } from "@langwatch/task";

import type { BillingLifecycleAnnouncerService } from "../services/billing-lifecycle-announcer.service.ts";

const logger = createLogger("langwatch:task:tiered-free-to-seat-event");

/** Organisations read per page; the scan pages by id, never loading them all (round 49). */
export const TIERED_FREE_PAGE_SIZE = 500;

/** The one read this migration makes, through organization's shared table (R40). */
export type TieredFreeToSeatEventMigrationDatabase = {
  organization: {
    findMany: (args: {
      where: {
        pricingModel: "TIERED";
        subscriptions: { none: object };
        id?: { gt: string };
      };
      select: { id: true; name: true; slug: true };
      orderBy: { id: "asc" };
      take: number;
    }) => Promise<{ id: string; name: string; slug: string }[]>;
  };
};

/** Where the move is recorded: billing's fact, which organization applies to its row (R42). */
export type TieredFreeToSeatEventMigrationFacts = Pick<
  BillingLifecycleAnnouncerService,
  "pricingModelChanged"
>;

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
  database,
  facts,
  execute,
  pageSize = TIERED_FREE_PAGE_SIZE,
}: {
  database: TieredFreeToSeatEventMigrationDatabase;
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
  let cursor: { after?: string } | null = {};
  while (cursor) {
    const { after }: { after?: string } = cursor;
    const page = await database.organization.findMany({
      where: {
        pricingModel: "TIERED",
        subscriptions: { none: {} },
        ...(after ? { id: { gt: after } } : {}),
      },
      select: { id: true, name: true, slug: true },
      orderBy: { id: "asc" },
      take: pageSize,
    });
    found += page.length;
    logger.info({ count: page.length, orgs: page }, `Found ${page.length} organization(s) to move`);
    if (execute) {
      for (const org of page) {
        await facts.pricingModelChanged({ organizationId: org.id, pricingModel: "SEAT_EVENT" });
        updated += 1;
      }
    }
    const last = page.at(-1);
    cursor = last && page.length === pageSize ? { after: last.id } : null;
  }

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
      database: () => TieredFreeToSeatEventMigrationDatabase;
      facts: TieredFreeToSeatEventMigrationFacts;
    },
  ) {
    super();
  }

  static create(deps: {
    database: () => TieredFreeToSeatEventMigrationDatabase;
    facts: TieredFreeToSeatEventMigrationFacts;
  }): TieredFreeToSeatEventMigrateTask {
    return new TieredFreeToSeatEventMigrateTask(deps);
  }

  async run({ args }: { args: readonly string[]; signal: AbortSignal }): Promise<void> {
    await runTieredFreeToSeatEventMigration({
      database: this.deps.database(),
      facts: this.deps.facts,
      execute: args.includes("--execute"),
    });
  }
}
