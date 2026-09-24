import { prismaDouble } from "@langwatch/test-harness/client-doubles/prisma";
import { fromDate } from "@langwatch/time";
import { describe, expect, it, vi } from "vitest";

import { PrismaProjectRepository } from "../prisma.project.repository.ts";

const destination = {
  id: "project_destination",
  teamId: "team_destination",
  apiKey: "project-api-key",
  archivedAt: null,
};

function repositoryWithQueries(options: {
  findFirst: (typeof destination | null)[];
  alternatives?: number;
  paths?: { id: string; name: string; team: { name: string; organization: { name: string } } }[];
}) {
  const project = {
    findFirst: vi.fn(async () => options.findFirst.shift() ?? null),
    count: vi.fn(async () => options.alternatives ?? 0),
    findMany: vi.fn(async () => options.paths ?? []),
  };
  const database = prismaDouble({ project });
  return { repository: PrismaProjectRepository.create({ prisma: database }), project };
}

describe("PrismaProjectRepository trace destinations", () => {
  it("lists full project paths for exactly the requested ids without hiding archived relations", async () => {
    const { repository, project } = repositoryWithQueries({
      findFirst: [],
      paths: [
        {
          id: "project-1",
          name: "Project",
          team: { name: "Team", organization: { name: "Organization" } },
        },
      ],
    });

    await expect(repository.findPaths({ projectIds: ["project-1"] })).resolves.toEqual([
      { projectId: "project-1", fullPath: "Organization / Team / Project" },
    ]);
    expect(project.findMany).toHaveBeenCalledWith({
      where: { id: { in: ["project-1"] } },
      select: {
        id: true,
        name: true,
        team: { select: { name: true, organization: { select: { name: true } } } },
      },
    });
  });

  it("finds a live project only inside the named organization", async () => {
    const { repository, project } = repositoryWithQueries({ findFirst: [destination] });

    await expect(
      repository.findLiveTraceDestination({
        organizationId: "org_1",
        projectId: destination.id,
      }),
    ).resolves.toEqual(destination);
    expect(project.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          id: destination.id,
          team: { organizationId: "org_1" },
          archivedAt: null,
        },
      }),
    );
  });

  it("finds the oldest live governance project deterministically", async () => {
    const { repository, project } = repositoryWithQueries({ findFirst: [destination] });

    await expect(repository.findOldestGovernanceTraceDestination("org_1")).resolves.toEqual(
      destination,
    );
    expect(project.findFirst).toHaveBeenCalledWith(
      expect.objectContaining({ orderBy: [{ createdAt: "asc" }, { id: "asc" }] }),
    );
  });

  it("counts only live non-governance alternatives", async () => {
    const { repository, project } = repositoryWithQueries({
      findFirst: [],
      alternatives: 2,
    });

    await expect(repository.countLiveNonGovernanceProjects("org_1")).resolves.toBe(2);
    expect(project.count).toHaveBeenCalledWith({
      where: {
        team: { organizationId: "org_1" },
        kind: { not: "internal_governance" },
        archivedAt: null,
      },
    });
  });
});

describe("PrismaProjectRepository.tryGetTraceDestination", () => {
  it("follows an archived stored pointer", async () => {
    const archived = { ...destination, archivedAt: new Date("2026-01-01T00:00:00.000Z") };
    const project = { findUnique: vi.fn(async () => archived) };
    const database = prismaDouble({ project });

    await expect(
      PrismaProjectRepository.create({ prisma: database }).findTraceDestination(archived.id),
    ).resolves.toEqual(archived);
  });
});

describe("PrismaProjectRepository.listTraceDestinations", () => {
  it("returns rows in the requested order and omits unknown ids", async () => {
    const first = { ...destination, id: "project_first" };
    const second = { ...destination, id: "project_second" };
    const project = { findMany: vi.fn(async () => [second, first]) };
    const database = prismaDouble({ project });

    await expect(
      PrismaProjectRepository.create({ prisma: database }).findTraceDestinations([
        first.id,
        "project_unknown",
        second.id,
      ]),
    ).resolves.toEqual([first, second]);
  });
});

describe("PrismaProjectRepository coding-agent activity", () => {
  it.each([
    ["session", "lastCodingAgentSessionAt", "touchCodingAgentSessionSeen"],
    ["pull request", "lastCodingAgentPullRequestAt", "touchCodingAgentPullRequestSeen"],
  ] as const)("throttles the %s clock independently", async (_name, field, method) => {
    const updateMany = vi.fn().mockResolvedValue({ count: 1 });
    const repository = PrismaProjectRepository.create({
      prisma: prismaDouble({ project: { updateMany } }),
    });
    const at = new Date("2026-08-25T12:00:00.000Z");
    const staleBefore = new Date("2026-08-25T11:00:00.000Z");

    await repository[method]({
      projectId: "project-1",
      at: fromDate(at),
      staleBefore: fromDate(staleBefore),
    });

    expect(updateMany).toHaveBeenCalledWith({
      where: {
        id: "project-1",
        archivedAt: null,
        OR: [{ [field]: null }, { [field]: { lte: staleBefore } }],
      },
      data: { [field]: at },
    });
  });
});

describe("PrismaProjectRepository.findOrganizationId", () => {
  it("preserves optional tenant resolution for archived and missing projects", async () => {
    const findUnique = vi
      .fn()
      .mockResolvedValueOnce({ team: { organizationId: "org_1" } })
      .mockResolvedValueOnce(null);
    const repository = PrismaProjectRepository.create({
      prisma: prismaDouble({ project: { findUnique } }),
    });

    await expect(repository.findOrganizationId("project_archived")).resolves.toBe("org_1");
    await expect(repository.findOrganizationId("project_missing")).resolves.toBe(undefined);
    expect(findUnique).toHaveBeenNthCalledWith(1, {
      where: { id: "project_archived" },
      select: { team: { select: { organizationId: true } } },
    });
  });
});
