import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { MemoryOrganizationDatabase } from "../memory.organization.database.ts";
import { MemoryOrganizationRepository } from "../memory.organization.repository.ts";

const at = Temporal.Instant.from("2026-09-01T00:00:00Z");

const resources = {
  teamId: "team_personal",
  teamSlug: "ada-workspace",
  projectId: "project_personal",
  projectSlug: "ada-personal",
  projectApiKey: "sk-lw-personal",
  ownerBindingId: "binding_personal",
};

function seededWithAdministrator() {
  const memory = MemoryOrganizationDatabase.create();
  memory.users.set("user_ada", {
    id: "user_ada",
    name: "Ada",
    email: "ada@acme.test",
    deactivatedAt: null,
  });
  memory.organizationUsers.push({
    userId: "user_ada",
    organizationId: "org_1",
    role: "ADMIN",
    disabledAt: null,
    createdAt: at,
    updatedAt: at,
  });
  return { memory, repository: MemoryOrganizationRepository.create({ memory }) };
}

describe("MemoryOrganizationRepository.ensurePersonalWorkspace", () => {
  describe("given a person who is already an administrator of the organization", () => {
    /** @scenario Ensuring a personal workspace leaves an existing membership as it was */
    it("creates the workspace and leaves their one Administrator membership as it was", async () => {
      const { memory, repository } = seededWithAdministrator();

      const result = await repository.ensurePersonalWorkspace({
        workspace: { userId: "user_ada", organizationId: "org_1", displayName: "Ada" },
        resources,
      });

      expect(result.created).toBe(true);
      expect(
        memory.organizationUsers
          .filter((row) => row.userId === "user_ada" && row.organizationId === "org_1")
          .map((row) => row.role),
      ).toEqual(["ADMIN"]);
    });
  });
});
