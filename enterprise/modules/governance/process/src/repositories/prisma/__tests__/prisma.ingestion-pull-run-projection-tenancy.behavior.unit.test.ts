import type { StoredProjection } from "@langwatch/eventing";
import { createTenantId } from "@langwatch/eventing";
import { prismaDouble } from "@langwatch/test-harness/client-doubles/prisma";
import { describe, expect, it, vi } from "vitest";

import type { IngestionPullRunStatusData } from "../../../eventing/ingestion-pull-run-status-eventing.projection.ts";
import { PrismaIngestionPullRunProjectionRepository } from "../prisma.ingestion-pull-run-projection.repository.ts";

type GuardParams = {
  action: "findUnique" | "upsert";
  args: { where?: Record<string, unknown>; [key: string]: unknown };
};

const PROJECT_ID = "governance-project-1";
const SOURCE_ID = "source-1";

async function runGuard(action: GuardParams["action"], args: GuardParams["args"]): Promise<void> {
  if (action !== "findUnique" && action !== "upsert") {
    throw new Error(`Unexpected projection action: ${JSON.stringify(action)}`);
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
      LastSuccessAt: 2_000,
      LastRunScheduledFor: 1_500,
      LastReadThroughAt: null,
      LastRunCompleteness: null,
      LastAgentsListingAt: null,
      LastAgentsListingOutcome: null,
      LastAgentsListingCount: null,
      LastAgentsListingReason: null,
      LastAgentsListingStatus: null,
      LastPeopleListingAt: null,
      LastPeopleListingOutcome: null,
      LastPeopleDirectoryCount: null,
      LastPeopleWithheldCount: null,
      LastPeopleListingReason: null,
      LastPeopleListingStatus: null,
      // A listed agents outcome and a refused people one, on the same row at
      // the same time: the two kinds keep their own columns precisely so this
      // is representable, and a fixture that only ever carried one kind would
      // not notice a repository that dropped the other.
      CreatedAt: 1_000,
      UpdatedAt: 2_000,
      LastEventOccurredAt: 2_000,
    },
    cursor: { acceptedAt: 2_001, eventId: "event-1" },
    occurredAt: 2_000,
    createdAt: 1_000,
    updatedAt: 2_000,
    version: "2026-08-28",
  };
}

describe("PrismaIngestionPullRunProjectionRepository tenancy", () => {
  it("loads a source projection through the guarded Prisma client", async () => {
    const findUnique = vi.fn(async (args: GuardParams["args"]) => {
      await runGuard("findUnique", args);
      return null;
    });
    const repository = PrismaIngestionPullRunProjectionRepository.create(
      prismaDouble({ ingestionPullRunProjection: { findUnique } }),
    );

    await expect(
      repository.get(SOURCE_ID, {
        aggregateId: SOURCE_ID,
        tenantId: createTenantId(PROJECT_ID),
      }),
    ).resolves.toEqual({ kind: "empty" });
    expect(findUnique).toHaveBeenCalledWith({
      where: { sourceId: SOURCE_ID, projectId: PROJECT_ID },
    });
  });

  it("stores a source projection through the guarded Prisma client", async () => {
    const upsert = vi.fn(async (args: GuardParams["args"]) => {
      await runGuard("upsert", args);
    });
    const tx = prismaDouble({
      ingestionPullRunProjection: { upsert },
      ingestionSource: { updateMany: vi.fn().mockResolvedValue({ count: 1 }) },
    });
    const prisma = prismaDouble({ $transaction: vi.fn(async (callback) => callback(tx)) });
    const repository = PrismaIngestionPullRunProjectionRepository.create(prisma);

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
