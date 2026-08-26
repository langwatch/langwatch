import { describe, expect, it, vi } from "vitest";
import { PrismaIngestionPullLifecycleRepository } from "../src/repositories/prisma/prisma-ingestion-pull-lifecycle.repository";
import type { IngestionPullLifecycleDatabase } from "../src/ports/ingestion-pull-lifecycle.port";

describe("PrismaIngestionPullLifecycleRepository", () => {
  it("only discovers processes belonging to Governance projects", async () => {
    const projectFindMany = vi.fn().mockResolvedValue([{ id: "gov-1" }]);
    const processFindMany = vi
      .fn()
      .mockResolvedValue([{ processKey: "source-with-removed-schedule" }]);
    const sourceFindMany = vi.fn().mockResolvedValue([]);
    const repository = PrismaIngestionPullLifecycleRepository.create({
      project: { findMany: projectFindMany },
      processManagerInstance: { findMany: processFindMany },
      ingestionSource: { findMany: sourceFindMany },
    } satisfies IngestionPullLifecycleDatabase);

    await repository.listForReconciliation();

    expect(projectFindMany).toHaveBeenCalledWith({
      where: { kind: "internal_governance", archivedAt: null },
      select: { id: true },
    });
    expect(processFindMany).toHaveBeenCalledWith({
      where: {
        processName: "ingestionPull",
        projectId: { in: ["gov-1"] },
      },
      select: { processKey: true },
    });
    expect(sourceFindMany).toHaveBeenCalledWith({
      where: {
        OR: [
          { pullSchedule: { not: null } },
          { id: { in: ["source-with-removed-schedule"] } },
        ],
      },
    });
  });

  it("does not issue an unscoped process query without Governance projects", async () => {
    const processFindMany = vi.fn();
    const repository = PrismaIngestionPullLifecycleRepository.create({
      project: { findMany: vi.fn().mockResolvedValue([]) },
      processManagerInstance: { findMany: processFindMany },
      ingestionSource: { findMany: vi.fn().mockResolvedValue([]) },
    } satisfies IngestionPullLifecycleDatabase);

    await repository.listForReconciliation();

    expect(processFindMany).not.toHaveBeenCalled();
  });
});
