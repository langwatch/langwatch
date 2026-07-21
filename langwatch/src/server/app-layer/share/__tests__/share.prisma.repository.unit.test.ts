import type { PrismaClient } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";
import { PrismaShareRepository } from "../repositories/share.prisma.repository";

describe("PrismaShareRepository.findByResourceType", () => {
  it("includes the project in the share lookup", async () => {
    const findFirst = vi.fn().mockResolvedValue(null);
    const repository = new PrismaShareRepository({
      publicShare: { findFirst },
    } as unknown as PrismaClient);

    await repository.findByResourceType({
      projectId: "project_1",
      resourceType: "TRACE",
      resourceId: "trace_1",
    });

    expect(findFirst).toHaveBeenCalledWith({
      where: {
        projectId: "project_1",
        resourceType: "TRACE",
        resourceId: "trace_1",
      },
    });
  });
});
