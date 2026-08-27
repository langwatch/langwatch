import { describe, expect, it, vi } from "vitest";
import { PrismaGraphTriggerSentRepository } from "../src/repositories/prisma/prisma.graph-trigger-sent.repository";

describe("PrismaGraphTriggerSentRepository candidate discovery", () => {
  it("scopes active graph-trigger projects and open incidents in Automation", async () => {
    const triggerFindMany = vi.fn(async () => [
      { projectId: "project-a" },
      { projectId: "project-a" },
    ]);
    const sentFindMany = vi.fn(async () => [{ projectId: "project-b" }]);
    const projectFindMany = vi.fn(async () => [{ id: "project-a" }, { id: "project-b" }]);
    const repository = PrismaGraphTriggerSentRepository.create({
      project: { findMany: projectFindMany },
      trigger: { findMany: triggerFindMany },
      triggerSent: { findMany: sentFindMany },
    } as never);

    expect(await repository.findProjectsWithGraphTriggers()).toEqual(["project-a"]);
    expect(await repository.findProjectsWithOpenGraphTriggerSent()).toEqual(new Set(["project-b"]));
    expect(triggerFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          projectId: { in: ["project-a", "project-b"] },
          active: true,
          deleted: false,
          customGraphId: { not: null },
        },
      }),
    );
    expect(sentFindMany).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          projectId: { in: ["project-a", "project-b"] },
          resolvedAt: null,
          customGraphId: { not: null },
        },
      }),
    );
  });

  it("classifies the selected graph series in the private repository", async () => {
    const findUnique = vi.fn(async () => ({
      graph: {
        series: [{ metric: "metadata.trace_id" }, { metric: "evaluations.score" }],
      },
    }));
    const repository = PrismaGraphTriggerSentRepository.create({
      customGraph: { findUnique },
    } as never);

    expect(
      await repository.tryFindGraphTriggerSource({
        triggerId: "trigger-1",
        customGraphId: "graph-1",
        projectId: "project-1",
        seriesName: "1/evaluations.score/avg",
      }),
    ).toBe("evaluation");
    expect(findUnique).toHaveBeenCalledWith(
      expect.objectContaining({
        where: { id: "graph-1", projectId: "project-1", kind: "builder" },
      }),
    );
  });
});
