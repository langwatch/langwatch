import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  DestinationTeamNotFoundError,
  PersonalProjectProtectedError,
  PersonalWorkspaceBoundaryError,
  ProjectNotFoundError,
  ProjectService,
} from "../project.service";
import { NullProjectRepository } from "../repositories/project.repository";

function createMockRepo() {
  const repo = new NullProjectRepository();
  vi.spyOn(repo, "update");
  vi.spyOn(repo, "findActiveTeamInOrganization");
  vi.spyOn(repo, "getById");
  vi.spyOn(repo, "getWithTeam");
  vi.spyOn(repo, "archive");
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
        vi.mocked(repo.findActiveTeamInOrganization).mockResolvedValue({
          id: "t2",
          isPersonal: false,
        });
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

  describe("when the move crosses the personal workspace boundary", () => {
    /** @scenario Editing a project cannot move it out of a personal workspace */
    it("refuses to move a personal project into a shared team", async () => {
      vi.mocked(repo.findActiveTeamInOrganization).mockResolvedValue({
        id: "shared",
        isPersonal: false,
      });
      vi.mocked(repo.getWithTeam).mockResolvedValue({
        id: "p1",
        teamId: "personal",
        isPersonal: true,
        team: { organizationId: "org1" },
      } as any);

      await expect(
        service.update({
          id: "p1",
          organizationId: "org1",
          data: { teamId: "shared" },
        }),
      ).rejects.toThrow(PersonalWorkspaceBoundaryError);

      expect(repo.update).not.toHaveBeenCalled();
    });

    /** @scenario Editing a project cannot move it into a personal workspace */
    it("refuses to move a shared project into a personal team", async () => {
      vi.mocked(repo.findActiveTeamInOrganization).mockResolvedValue({
        id: "personal",
        isPersonal: true,
      });
      vi.mocked(repo.getWithTeam).mockResolvedValue({
        id: "p1",
        teamId: "shared",
        isPersonal: false,
        team: { organizationId: "org1" },
      } as any);

      await expect(
        service.update({
          id: "p1",
          organizationId: "org1",
          data: { teamId: "personal" },
        }),
      ).rejects.toThrow(PersonalWorkspaceBoundaryError);

      expect(repo.update).not.toHaveBeenCalled();
    });

    it("still allows a rename that names the team the project is already in", async () => {
      vi.mocked(repo.findActiveTeamInOrganization).mockResolvedValue({
        id: "personal",
        isPersonal: true,
      });
      vi.mocked(repo.getWithTeam).mockResolvedValue({
        id: "p1",
        teamId: "personal",
        isPersonal: true,
        team: { organizationId: "org1" },
      } as any);
      vi.mocked(repo.update).mockResolvedValue({
        id: "p1",
        name: "My Workspace",
        teamId: "personal",
      } as any);

      await expect(
        service.update({
          id: "p1",
          organizationId: "org1",
          data: { name: "My Workspace", teamId: "personal" },
        }),
      ).resolves.toMatchObject({ name: "My Workspace" });
    });
  });

  describe("when archiving a personal project", () => {
    /** @scenario Deleting a project cannot empty a personal workspace */
    it("refuses, because the workspace is the project", async () => {
      vi.mocked(repo.getWithTeam).mockResolvedValue({
        id: "p1",
        teamId: "personal",
        isPersonal: true,
        team: { organizationId: "org1" },
      } as any);

      await expect(
        service.archive({ id: "p1", organizationId: "org1" }),
      ).rejects.toThrow(PersonalProjectProtectedError);

      expect(repo.archive).not.toHaveBeenCalled();
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
