import { describe, expect, it, vi } from "vitest";

import type { IngestionPullLifecycleDatabase } from "../../ingestion-pull-lifecycle.repository.ts";
import { PrismaIngestionPullLifecycleRepository } from "../prisma.ingestion-pull-lifecycle.repository.ts";

describe("PrismaIngestionPullLifecycleRepository", () => {
  it("only discovers processes belonging to Governance projects", async () => {
    const processFindMany = vi
      .fn()
      .mockResolvedValue([{ processKey: "source-with-removed-schedule" }]);
    const sourceFindMany = vi.fn().mockResolvedValue([]);
    const repository = PrismaIngestionPullLifecycleRepository.create({
      processManagerInstance: { findMany: processFindMany },
      ingestionSource: { findMany: sourceFindMany },
    } satisfies IngestionPullLifecycleDatabase);

    await repository.findForReconciliation({ governanceProjectIds: ["gov-1"] });

    expect(processFindMany).toHaveBeenCalledWith({
      where: {
        processName: "ingestionPull",
        projectId: { in: ["gov-1"] },
      },
      select: { processKey: true },
    });
    expect(sourceFindMany).toHaveBeenCalledWith({
      where: {
        OR: [{ pullSchedule: { not: null } }, { id: { in: ["source-with-removed-schedule"] } }],
      },
    });
  });

  it("does not issue an unscoped process query without Governance projects", async () => {
    const processFindMany = vi.fn();
    const repository = PrismaIngestionPullLifecycleRepository.create({
      processManagerInstance: { findMany: processFindMany },
      ingestionSource: { findMany: vi.fn().mockResolvedValue([]) },
    } satisfies IngestionPullLifecycleDatabase);

    await repository.findForReconciliation({ governanceProjectIds: [] });

    expect(processFindMany).not.toHaveBeenCalled();
  });
});
