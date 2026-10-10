import { describe, expect, it, vi } from "vitest";

import { PrismaWorkflowRepository } from "../prisma.workflow.repository.ts";

function fixture() {
  const workflow = {
    findFirst: vi.fn(),
    findMany: vi.fn(async (): Promise<unknown[]> => []),
    create: vi.fn(),
    update: vi.fn(),
    delete: vi.fn(),
  };
  const workflowVersion = {
    findFirst: vi.fn(),
    findMany: vi.fn(),
    create: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
    deleteMany: vi.fn(),
  };

  return {
    workflow,
    workflowVersion,
    repository: PrismaWorkflowRepository.create({ database: { workflow, workflowVersion } }),
  };
}

describe("workflow linkage persistence", () => {
  it("keeps missing or archived related graphs absent", async () => {
    const { workflow, repository } = fixture();

    await expect(
      repository.findSummaries({ projectId: "project-1", workflowIds: ["wf-1"] }),
    ).resolves.toEqual([]);
    expect(workflow.findMany).toHaveBeenCalledWith({
      where: { id: { in: ["wf-1"] }, projectId: "project-1", archivedAt: null },
      select: { id: true, name: true },
    });
  });

  it("archives by project and identifier without changing version pointers", async () => {
    const { workflow, repository } = fixture();
    workflow.update.mockResolvedValue({ id: "wf-1" });

    await expect(
      repository.archiveLinked({ projectId: "project-1", workflowId: "wf-1" }),
    ).resolves.toEqual({ id: "wf-1" });
    expect(workflow.update).toHaveBeenCalledWith({
      where: { id: "wf-1", projectId: "project-1" },
      data: { archivedAt: expect.any(Date) },
      select: { id: true },
    });
  });

  /** @scenario "A failed peer copy removes only the newly copied workflow" */
  it("clears restrictive references before removing copied versions and their workflow", async () => {
    const { workflow, workflowVersion, repository } = fixture();
    await repository.deleteUncommitted({ projectId: "project-1", workflowId: "wf-1" });

    expect(workflow.update).toHaveBeenCalledWith({
      where: { id: "wf-1", projectId: "project-1" },
      data: { currentVersionId: null, latestVersionId: null },
    });
    expect(workflowVersion.updateMany).toHaveBeenCalledWith({
      where: { workflowId: "wf-1", projectId: "project-1" },
      data: { parentId: null },
    });
    expect(workflowVersion.deleteMany).toHaveBeenCalledWith({
      where: { workflowId: "wf-1", projectId: "project-1" },
    });
    expect(workflow.delete).toHaveBeenCalledWith({ where: { id: "wf-1", projectId: "project-1" } });
    expect(workflow.update.mock.invocationCallOrder[0]).toBeLessThan(
      workflowVersion.updateMany.mock.invocationCallOrder[0]!,
    );
    expect(workflowVersion.updateMany.mock.invocationCallOrder[0]).toBeLessThan(
      workflowVersion.deleteMany.mock.invocationCallOrder[0]!,
    );
    expect(workflowVersion.deleteMany.mock.invocationCallOrder[0]).toBeLessThan(
      workflow.delete.mock.invocationCallOrder[0]!,
    );
  });
});
