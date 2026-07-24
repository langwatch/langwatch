import { describe, expect, it, vi } from "vitest";

import {
  getLimitBreakdownByProject,
  limitTypeHasBreakdown,
} from "../limit-breakdown";

const makePrisma = () =>
  ({
    project: { findMany: vi.fn() },
    dataset: { findMany: vi.fn() },
    workflow: { findMany: vi.fn() },
    llmPromptConfig: { findMany: vi.fn() },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any;

describe("getLimitBreakdownByProject", () => {
  describe("given a datasets limit across more than one project", () => {
    it("groups the datasets by project and drops projects with none", async () => {
      const prisma = makePrisma();
      prisma.project.findMany.mockResolvedValue([
        { id: "p1", name: "Project A", slug: "project-a" },
        { id: "p2", name: "Project B", slug: "project-b" },
        { id: "p3", name: "Project C", slug: "project-c" },
      ]);
      prisma.dataset.findMany.mockResolvedValue([
        { id: "d1", name: "dataset a", projectId: "p1" },
        { id: "d2", name: "dataset b", projectId: "p1" },
        { id: "d3", name: "dataset c", projectId: "p2" },
      ]);

      const result = await getLimitBreakdownByProject(prisma, {
        organizationId: "org-1",
        limitType: "datasets",
      });

      expect(result).toEqual([
        {
          projectId: "p1",
          projectName: "Project A",
          projectSlug: "project-a",
          resources: [
            { id: "d1", name: "dataset a" },
            { id: "d2", name: "dataset b" },
          ],
        },
        {
          projectId: "p2",
          projectName: "Project B",
          projectSlug: "project-b",
          resources: [{ id: "d3", name: "dataset c" }],
        },
      ]);
      // Project C has no datasets and is dropped from the breakdown.
      expect(prisma.dataset.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { projectId: { in: ["p1", "p2", "p3"] }, archivedAt: null },
        }),
      );
    });
  });

  describe("given a limit type with no listable resources", () => {
    it("returns an empty breakdown without touching the database", async () => {
      const prisma = makePrisma();

      const result = await getLimitBreakdownByProject(prisma, {
        organizationId: "org-1",
        limitType: "members",
      });

      expect(result).toEqual([]);
      expect(prisma.project.findMany).not.toHaveBeenCalled();
    });
  });

  describe("given an org with no projects", () => {
    it("returns an empty breakdown", async () => {
      const prisma = makePrisma();
      prisma.project.findMany.mockResolvedValue([]);

      const result = await getLimitBreakdownByProject(prisma, {
        organizationId: "org-1",
        limitType: "workflows",
      });

      expect(result).toEqual([]);
      expect(prisma.workflow.findMany).not.toHaveBeenCalled();
    });
  });
});

describe("limitTypeHasBreakdown", () => {
  it("is true for datasets, workflows and prompts and false otherwise", () => {
    expect(limitTypeHasBreakdown("datasets")).toBe(true);
    expect(limitTypeHasBreakdown("workflows")).toBe(true);
    expect(limitTypeHasBreakdown("prompts")).toBe(true);
    expect(limitTypeHasBreakdown("members")).toBe(false);
    expect(limitTypeHasBreakdown("teams")).toBe(false);
  });
});
