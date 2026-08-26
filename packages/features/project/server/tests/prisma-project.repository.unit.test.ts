import { describe, expect, it, vi } from "vitest";
import type { ProjectDatabase } from "../src/ports/project.port";
import { PrismaProjectRepository } from "../src/repositories/prisma/prisma-project.repository";

const destination = {
  id: "project_destination",
  teamId: "team_destination",
  apiKey: "project-api-key",
  archivedAt: null,
};

function repositoryWithQueries(options: {
  findFirst: Array<typeof destination | null>;
  alternatives?: number;
}) {
  const project = {
    findFirst: vi.fn(async () => options.findFirst.shift() ?? null),
    count: vi.fn(async () => options.alternatives ?? 0),
  };
  const database: ProjectDatabase = { project, team: {} };
  return { repository: PrismaProjectRepository.create(database), project };
}

describe("PrismaProjectRepository trace destinations", () => {
  it("finds a live project only inside the named organization", async () => {
    const { repository, project } = repositoryWithQueries({ findFirst: [destination] });

    await expect(
      repository.tryFindLiveTraceDestination({
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

    await expect(
      repository.tryFindOldestGovernanceTraceDestination("org_1"),
    ).resolves.toEqual(destination);
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
    const database: ProjectDatabase = { project, team: {} };

    await expect(
      PrismaProjectRepository.create(database).tryGetTraceDestination(archived.id),
    ).resolves.toEqual(archived);
  });
});

describe("PrismaProjectRepository.listTraceDestinations", () => {
  it("returns rows in the requested order and omits unknown ids", async () => {
    const first = { ...destination, id: "project_first" };
    const second = { ...destination, id: "project_second" };
    const project = { findMany: vi.fn(async () => [second, first]) };
    const database: ProjectDatabase = { project, team: {} };

    await expect(
      PrismaProjectRepository.create(database).listTraceDestinations([
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
      project: { updateMany },
      team: {},
    });
    const at = new Date("2026-08-25T12:00:00.000Z");
    const staleBefore = new Date("2026-08-25T11:00:00.000Z");

    await repository[method]({ projectId: "project-1", at, staleBefore });

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
