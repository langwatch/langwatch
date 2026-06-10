import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  DestinationTeamNotFoundError,
  ProjectNotFoundError,
  ProjectService,
} from "../project.service";
import { NullProjectRepository } from "../repositories/project.repository";

function createMockRepo() {
  const repo = new NullProjectRepository();
  vi.spyOn(repo, "update");
  vi.spyOn(repo, "findActiveTeamInOrganization");
  return repo;
}

describe("ProjectService.update", () => {
  let repo: ReturnType<typeof createMockRepo>;
  let service: ProjectService;

  beforeEach(() => {
    repo = createMockRepo();
    service = new ProjectService(repo);
  });

  describe("when teamId is not provided", () => {
    /** @scenario ProjectService.update with no teamId leaves team unchanged */
    it("skips team validation and updates the project", async () => {
      const fakeProject = { id: "p1", name: "Updated", teamId: "t1" };
      vi.mocked(repo.update).mockResolvedValue(fakeProject as any);

      const result = await service.update({
        id: "p1",
        organizationId: "org1",
        data: { name: "Updated" },
      });

      expect(repo.findActiveTeamInOrganization).not.toHaveBeenCalled();
      expect(result.name).toBe("Updated");
    });
  });

  describe("when teamId is provided", () => {
    describe("when destination team exists in same org and is active", () => {
      /** @scenario ProjectService.update changes teamId with same-org validation */
      /** @scenario tRPC project.update accepts optional teamId */
      it("updates the project with new teamId", async () => {
        vi.mocked(repo.findActiveTeamInOrganization).mockResolvedValue({ id: "t2" });
        const fakeProject = { id: "p1", name: "Bot", teamId: "t2" };
        vi.mocked(repo.update).mockResolvedValue(fakeProject as any);

        const result = await service.update({
          id: "p1",
          organizationId: "org1",
          data: { teamId: "t2" },
        });

        expect(repo.findActiveTeamInOrganization).toHaveBeenCalledWith({
          teamId: "t2",
          organizationId: "org1",
        });
        expect(repo.update).toHaveBeenCalledWith({
          id: "p1",
          organizationId: "org1",
          data: { teamId: "t2" },
        });
        expect(result.teamId).toBe("t2");
      });
    });

    describe("when destination team does not exist", () => {
      /** @scenario tRPC project.update rejects cross-org team */
      it("throws DestinationTeamNotFoundError", async () => {
        vi.mocked(repo.findActiveTeamInOrganization).mockResolvedValue(null);

        await expect(
          service.update({
            id: "p1",
            organizationId: "org1",
            data: { teamId: "nonexistent" },
          }),
        ).rejects.toThrow(DestinationTeamNotFoundError);

        expect(repo.update).not.toHaveBeenCalled();
      });
    });

    describe("when destination team is archived", () => {
      /** @scenario ProjectService.update rejects archived destination team */
      it("throws DestinationTeamNotFoundError", async () => {
        vi.mocked(repo.findActiveTeamInOrganization).mockResolvedValue(null);

        await expect(
          service.update({
            id: "p1",
            organizationId: "org1",
            data: { teamId: "archived-team" },
          }),
        ).rejects.toThrow(DestinationTeamNotFoundError);

        expect(repo.update).not.toHaveBeenCalled();
      });
    });

    describe("when destination team belongs to different org", () => {
      it("throws DestinationTeamNotFoundError", async () => {
        vi.mocked(repo.findActiveTeamInOrganization).mockResolvedValue(null);

        await expect(
          service.update({
            id: "p1",
            organizationId: "org1",
            data: { teamId: "cross-org-team" },
          }),
        ).rejects.toThrow(DestinationTeamNotFoundError);
      });
    });
  });

  describe("when project is not found", () => {
    it("throws ProjectNotFoundError", async () => {
      vi.mocked(repo.update).mockResolvedValue(null);

      await expect(
        service.update({
          id: "missing",
          organizationId: "org1",
          data: { name: "Nope" },
        }),
      ).rejects.toThrow(ProjectNotFoundError);
    });
  });
});
