import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { reconcileIngestionPullProcesses } from "../ingestionPullLifecycle";

describe("reconcileIngestionPullProcesses", () => {
  it("scopes existing-process discovery to hidden governance projects", async () => {
    const projectFindMany = vi.fn().mockResolvedValue([{ id: "gov-1" }]);
    const processFindMany = vi
      .fn()
      .mockResolvedValue([{ processKey: "source-with-removed-schedule" }]);
    const sourceFindMany = vi.fn().mockResolvedValue([]);
    const prisma = {
      project: { findMany: projectFindMany },
      processManagerInstance: { findMany: processFindMany },
      ingestionSource: { findMany: sourceFindMany },
    } as unknown as PrismaClient;

    await reconcileIngestionPullProcesses({
      prisma,
      commands: { configure: vi.fn(), disable: vi.fn() },
    });

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

  it("does not issue an unscoped process query when no governance projects exist", async () => {
    const processFindMany = vi.fn();
    const prisma = {
      project: { findMany: vi.fn().mockResolvedValue([]) },
      processManagerInstance: { findMany: processFindMany },
      ingestionSource: { findMany: vi.fn().mockResolvedValue([]) },
    } as unknown as PrismaClient;

    await reconcileIngestionPullProcesses({
      prisma,
      commands: { configure: vi.fn(), disable: vi.fn() },
    });

    expect(processFindMany).not.toHaveBeenCalled();
  });
});
