import { describe, expect, it, vi } from "vitest";
import { PrismaProjectRepository } from "../src/repositories/prisma/prisma.project.repository";

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
