import { PostgresIngestionPullRunProjectionAdapter } from "../postgres.ingestion-pull-run-projection.adapter";
import type { IngestionPullRunStatusData } from "../../projections/ingestion-pull-run-status-eventing.projection";
import type { StoredProjection } from "@langwatch/eventing";
import { createTenantId } from "@langwatch/eventing";
import { describe, expect, it, vi } from "vitest";

type GuardParams = {
  action: "findUnique" | "upsert";
  args: { where?: Record<string, unknown>; [key: string]: unknown };
};

const PROJECT_ID = "governance-project-1";
const SOURCE_ID = "source-1";

async function runGuard(action: GuardParams["action"], args: GuardParams["args"]): Promise<void> {
  if (action !== "findUnique" && action !== "upsert") {
    throw new Error(`Unexpected projection action: ${action}`);
  }
  if (!args.where) {
    throw new Error("Projection access must include a tenant-scoped where clause");
  }
}

function storedProjection(): StoredProjection<IngestionPullRunStatusData> {
  return {
    state: {
      SourceId: SOURCE_ID,
      Enabled: true,
      Cron: "*/5 * * * *",
      Cursor: "cursor-2",
      LastRunAt: 2_000,
      LastRunOutcome: "completed",
      LastRunEventCount: 1,
      LastRunError: null,
      LastRunErrorCode: null,
      ConsecutiveErrors: 0,
      LastRunScheduledFor: 1_500,
      CreatedAt: 1_000,
      UpdatedAt: 2_000,
      LastEventOccurredAt: 2_000,
    },
    cursor: { acceptedAt: 2_001, eventId: "event-1" },
    occurredAt: 2_000,
    createdAt: 1_000,
    updatedAt: 2_000,
    version: "2026-07-17",
  };
}

describe("PrismaIngestionPullRunProjectionRepository tenancy", () => {
  it("loads a source projection through the guarded Prisma client", async () => {
    const findUnique = vi.fn(async (args: GuardParams["args"]) => {
      await runGuard("findUnique", args);
      return null;
    });
    const prisma = {
      ingestionPullRunProjection: {
        findUnique,
      },
    };
    const repository = PostgresIngestionPullRunProjectionAdapter.create(prisma).build();

    await expect(
      repository.tryLoad(SOURCE_ID, {
        aggregateId: SOURCE_ID,
        tenantId: createTenantId(PROJECT_ID),
      }),
    ).resolves.toBeNull();
    expect(findUnique).toHaveBeenCalledWith({
      where: { sourceId: SOURCE_ID, projectId: PROJECT_ID },
    });
  });

  it("stores a source projection through the guarded Prisma client", async () => {
    const upsert = vi.fn(async (args: GuardParams["args"]) => {
      await runGuard("upsert", args);
    });
    const tx = {
      ingestionPullRunProjection: {
        upsert,
      },
      ingestionSource: {
        updateMany: vi.fn().mockResolvedValue({ count: 1 }),
      },
    };
    const prisma = {
      $transaction: vi.fn(async (callback: (client: typeof tx) => unknown) => callback(tx)),
    };
    const repository = PostgresIngestionPullRunProjectionAdapter.create(prisma).build();

    await expect(
      repository.store(storedProjection(), {
        aggregateId: SOURCE_ID,
        tenantId: createTenantId(PROJECT_ID),
      }),
    ).resolves.toBeUndefined();
    expect(upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { sourceId: SOURCE_ID, projectId: PROJECT_ID },
      }),
    );
  });
});
