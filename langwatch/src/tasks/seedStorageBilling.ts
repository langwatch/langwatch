import { nanoid } from "nanoid";
import { getApp } from "~/server/app-layer/app";
import { initializeDefaultApp } from "~/server/app-layer/presets";
import { BoundaryMeasurementService } from "../server/app-layer/billing/storage/boundaryMeasurement.service";
import { PrismaStorageBoundaryEventRepository } from "../server/app-layer/billing/storage/repositories/storage-boundary-event.prisma.repository";
import {
  SEED_DEFAULT_LOOKBACK_DAYS,
  StorageSeedingService,
} from "../server/app-layer/billing/storage/storageSeeding.service";
import { getClickHouseClientForProject } from "../server/clickhouse/clickhouseClient";
import { prisma } from "../server/db";
import { createLogger } from "../utils/logger/server";

const logger = createLogger("langwatch:tasks:seedStorageBilling");

/**
 * ADR-039 phase 3: operator-run storage-billing seed (never automatic).
 *
 *   pnpm task seedStorageBilling <organizationId> [lookbackDays]
 *   pnpm task seedStorageBilling --all [lookbackDays]
 *
 * PRECONDITION: run the `MATERIALIZE COLUMN _size_bytes` backfill (#5255)
 * first — seeding old parts without it hits the lazy-recompute path, the
 * actual expensive query shape.
 *
 * Value-idempotent: re-running emits only deltas not yet recorded. Also the
 * operator re-seed path for a drift-alarmed org: corrective SEED events are
 * appended through the normal fold (full audit trail), never overwriting
 * the gauge.
 */
export default async function execute(
  organizationIdOrAll?: string,
  lookbackDaysArg?: string,
) {
  if (!organizationIdOrAll) {
    throw new Error(
      "Usage: pnpm task seedStorageBilling <organizationId>|--all [lookbackDays]",
    );
  }
  initializeDefaultApp();

  const lookbackDays = lookbackDaysArg
    ? Number(lookbackDaysArg)
    : SEED_DEFAULT_LOOKBACK_DAYS;
  if (!Number.isFinite(lookbackDays) || lookbackDays <= 0) {
    throw new Error(
      `lookbackDays must be a positive number, got "${lookbackDaysArg}"`,
    );
  }

  const events = new PrismaStorageBoundaryEventRepository(prisma);
  const listProjectIds = async ({
    organizationId,
  }: {
    organizationId: string;
  }) => {
    const projects = await prisma.project.findMany({
      where: { team: { organizationId } },
      select: { id: true },
    });
    return projects.map((project) => project.id);
  };
  const seeding = new StorageSeedingService({
    measurement: new BoundaryMeasurementService({
      resolveClickHouseClient: async (tenantId: string) => {
        const client = await getClickHouseClientForProject(tenantId);
        if (!client) {
          throw new Error(
            `No ClickHouse client resolvable for project ${tenantId} — is ClickHouse enabled?`,
          );
        }
        return client;
      },
      events,
      listProjectIds,
    }),
    listProjectIds,
  });

  const organizationIds =
    organizationIdOrAll === "--all"
      ? await getApp().organizations.listBillableOrganizationIds()
      : [organizationIdOrAll];

  const at = new Date();
  for (const organizationId of organizationIds) {
    const seedRunId = `seed_${nanoid(10)}`;
    const result = await seeding.seedOrganization({
      organizationId,
      at,
      seedRunId,
      lookbackDays,
    });
    logger.info({ organizationId, seedRunId, ...result }, "org seeded");
  }
}
