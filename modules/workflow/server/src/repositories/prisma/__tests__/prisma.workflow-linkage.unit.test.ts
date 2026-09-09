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
    repository: PrismaWorkflowRepository.create({ workflow, workflowVersion }),
  };
}

describe("workflow linkage persistence", () => {
  it("loads current graph fields in one project-scoped batch excluding archived graphs", async () => {
    const { workflow, repository } = fixture();
    workflow.findMany.mockResolvedValue([
      { id: "wf-1", currentVersion: { dsl: { nodes: [] } } },
      { id: "wf-2", currentVersion: null },
    ]);

    await expect(
      repository.listFieldSources({ projectId: "project-1", workflowIds: ["wf-1", "wf-2"] }),
    ).resolves.toEqual([
      { id: "wf-1", dsl: { nodes: [] } },
      { id: "wf-2", dsl: void 0 },
    ]);
    expect(workflow.findMany).toHaveBeenCalledExactlyOnceWith({
      where: { id: { in: ["wf-1", "wf-2"] }, projectId: "project-1", archivedAt: null },
      select: { id: true, currentVersion: { select: { dsl: true } } },
    });
  });

  it("keeps missing or archived related graphs absent", async () => {
    const { workflow, repository } = fixture();

    await expect(
      repository.listSummaries({ projectId: "project-1", workflowIds: ["wf-1"] }),
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
