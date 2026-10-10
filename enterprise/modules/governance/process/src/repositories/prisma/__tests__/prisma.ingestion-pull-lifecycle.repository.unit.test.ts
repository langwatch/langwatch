import { describe, expect, it, vi } from "vitest";

import type { IngestionPullLifecycleDatabase } from "../prisma.ingestion-pull-lifecycle.repository.ts";
import { PrismaIngestionPullLifecycleRepository } from "../prisma.ingestion-pull-lifecycle.repository.ts";

describe("PrismaIngestionPullLifecycleRepository", () => {
  it("reads scheduled sources and the sources whose pull processes it was handed", async () => {
    const sourceFindMany = vi.fn().mockResolvedValue([]);
    const repository = PrismaIngestionPullLifecycleRepository.create({
      ingestionSource: { findMany: sourceFindMany },
    } satisfies IngestionPullLifecycleDatabase);

    await repository.findForReconciliation({ processKeys: ["source-with-removed-schedule"] });

    expect(sourceFindMany).toHaveBeenCalledWith({
      where: {
        OR: [{ pullSchedule: { not: null } }, { id: { in: ["source-with-removed-schedule"] } }],
      },
    });
  });
});
