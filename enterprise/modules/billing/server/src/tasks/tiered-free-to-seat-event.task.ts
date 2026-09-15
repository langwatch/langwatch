import { createLogger } from "@langwatch/observability";
import { Task } from "@langwatch/task";

const logger = createLogger("langwatch:task:tiered-free-to-seat-event");

/** Exactly the operations this migration performs, and nothing else. */
export type TieredFreeToSeatEventMigrationDatabase = {
  organization: {
    findMany(args: {
      where: { pricingModel: "TIERED"; subscriptions: { none: object } };
      select: { id: true; name: true; slug: true; pricingModel: true };
    }): Promise<{ id: string; name: string; slug: string; pricingModel: string }[]>;
    updateMany(args: {
      where: { id: { in: string[] }; pricingModel: "TIERED" };
      data: { pricingModel: "SEAT_EVENT" };
    }): Promise<{ count: number }>;
  };
};

export type TieredFreeToSeatEventMigrationOutcome = {
  found: number;
  updated: number;
};

/**
 * Moves every TIERED-pricing organization with no subscription at all onto
 * SEAT_EVENT. `--execute` is required to write; without it this only lists
 * the organizations that would move.
 */
export async function runTieredFreeToSeatEventMigration({
  database,
  execute,
}: {
  database: TieredFreeToSeatEventMigrationDatabase;
  execute: boolean;
}): Promise<TieredFreeToSeatEventMigrationOutcome> {
  logger.info(
    { execute },
    `Migrate TIERED free-plan orgs to SEAT_EVENT (${execute ? "EXECUTE" : "DRY RUN"})`,
  );

  const orgs = await database.organization.findMany({
    where: { pricingModel: "TIERED", subscriptions: { none: {} } },
    select: { id: true, name: true, slug: true, pricingModel: true },
  });

  logger.info({ count: orgs.length, orgs }, `Found ${orgs.length} organization(s) to migrate`);

  if (orgs.length === 0 || !execute) {
    if (orgs.length > 0) {
      logger.info("This is a dry run. Re-run with --execute to apply changes.");
    }
    return { found: orgs.length, updated: 0 };
  }

  const result = await database.organization.updateMany({
    where: { id: { in: orgs.map((org) => org.id) }, pricingModel: "TIERED" },
    data: { pricingModel: "SEAT_EVENT" },
  });

  logger.info({ count: result.count }, `Updated ${result.count} organization(s) to SEAT_EVENT.`);
  return { found: orgs.length, updated: result.count };
}

/**
 * The task-launcher entry — `pnpm --filter @langwatch/tasks task
 * tiered-free-to-seat-event -- --execute`.
 */
export class TieredFreeToSeatEventMigrateTask extends Task {
  readonly name = "tiered-free-to-seat-event";
  readonly description =
    "Moves TIERED-pricing organizations with no subscription onto SEAT_EVENT. Pass --execute to write.";

  private constructor(private readonly database: () => TieredFreeToSeatEventMigrationDatabase) {
    super();
  }

  static create({
    database,
  }: {
    database: () => TieredFreeToSeatEventMigrationDatabase;
  }): TieredFreeToSeatEventMigrateTask {
    return new TieredFreeToSeatEventMigrateTask(database);
  }

  async run({ args }: { args: readonly string[]; signal: AbortSignal }): Promise<void> {
    await runTieredFreeToSeatEventMigration({
      database: this.database(),
      execute: args.includes("--execute"),
    });
  }
}
