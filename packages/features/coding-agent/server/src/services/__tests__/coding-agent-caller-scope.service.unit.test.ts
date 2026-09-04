import { describe, expect, it } from "vitest";
import {
  CodingAgentCallerScopeDirectoryPort,
  CodingAgentScopePermissionsPort,
  type CodingAgentScopeProject,
} from "../../ports/coding-agent-caller-scope.port";
import { CodingAgentCallerScopeService } from "../coding-agent-caller-scope.service";

const caller = { kind: "user", userId: "user-1" } as const;

class FakeDirectory extends CodingAgentCallerScopeDirectoryPort {
  projects: CodingAgentScopeProject[] = [];
  ownerNames = new Map<string, string>();
  listPersonalTeamOwnerNamesCalls: readonly string[][] = [];

  listOrganizationProjects(): Promise<readonly CodingAgentScopeProject[]> {
    return Promise.resolve(this.projects);
  }

  listPersonalTeamOwnerNames(input: { teamIds: readonly string[] }): Promise<ReadonlyMap<string, string>> {
    this.listPersonalTeamOwnerNamesCalls = [...this.listPersonalTeamOwnerNamesCalls, input.teamIds];
    return Promise.resolve(this.ownerNames);
  }
}

class AllowAllPermissions extends CodingAgentScopePermissionsPort {
  projectCuts(input: { projects: readonly CodingAgentScopeProject[] }) {
    const ids = new Set(input.projects.map((project) => project.id));
    return Promise.resolve(new Map([["traces:view", ids] as const, ["cost:view", ids] as const]));
  }
}

function service(directory: FakeDirectory) {
  return CodingAgentCallerScopeService.create({ directory, permissions: new AllowAllPermissions() });
}

describe("given a caller resolving their reach across an organization's projects", () => {
  describe("when a permitted project is a personal workspace with an owner name", () => {
    /** @scenario "A personal workspace resolves to the person who owns it" */
    it("labels it by the person who owns it", async () => {
      const directory = new FakeDirectory();
      directory.projects = [
        { id: "p1", name: "Ada's workspace", slug: "ada", teamId: "team-1", isPersonal: true },
      ];
      directory.ownerNames = new Map([["team-1", "Ada Lovelace"]]);

      const scope = await service(directory).resolve({ caller, organizationId: "org-1" });

      expect(scope.projects.p1).toMatchObject({
        contributorLabel: "Ada Lovelace",
        isLinkable: false,
      });
    });
  });

  describe("when a personal workspace has no member to name it after", () => {
    /** @scenario "A personal workspace nobody is a member of keeps its own name" */
    it("keeps the workspace's own name", async () => {
      const directory = new FakeDirectory();
      directory.projects = [
        { id: "p1", name: "Orphaned workspace", slug: "orphaned", teamId: "team-1", isPersonal: true },
      ];
      directory.ownerNames = new Map();

      const scope = await service(directory).resolve({ caller, organizationId: "org-1" });

      expect(scope.projects.p1?.contributorLabel).toBe("Orphaned workspace");
    });
  });

  describe("when the organization has both personal and shared projects", () => {
    /** @scenario "Members are read for personal teams alone" */
    it("asks for owner names only for the personal teams", async () => {
      const directory = new FakeDirectory();
      directory.projects = [
        { id: "p1", name: "Ada's workspace", slug: "ada", teamId: "team-1", isPersonal: true },
        { id: "p2", name: "Shared", slug: "shared", teamId: "team-2", isPersonal: false },
      ];

      await service(directory).resolve({ caller, organizationId: "org-1" });

      expect(directory.listPersonalTeamOwnerNamesCalls).toEqual([["team-1"]]);
    });
  });
});
