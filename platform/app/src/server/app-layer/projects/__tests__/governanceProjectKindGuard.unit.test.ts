import { PROJECT_KIND } from "@ee/governance/services/governanceProject.service";
import { describe, expect, it, vi } from "vitest";
import type { Project } from "~/generated/prisma/client";
import {
  GOVERNANCE_PROJECT_ROUTE_REFUSAL,
  GovernanceProjectProtectedError,
  governanceProjectRouteViolation,
  INTERNAL_GOVERNANCE_PROJECT_KIND,
  ProjectService,
} from "../project.service";
import type { ProjectRepository } from "../repositories/project.repository";

const ORG = "org_a";

/**
 * A repository stand-in. Only `getWithTeam` decides anything here; the write
 * methods exist to prove they were never reached.
 */
function repoHolding(kind: string): ProjectRepository {
  return {
    getWithTeam: vi.fn().mockResolvedValue({
      id: "project_1",
      kind,
      isPersonal: false,
      teamId: "team_a",
      team: { id: "team_a", organizationId: ORG },
    }),
    update: vi.fn().mockResolvedValue({ id: "project_1" } as Project),
    archive: vi.fn().mockResolvedValue({ id: "project_1" } as Project),
  } as unknown as ProjectRepository;
}

describe("given the shared rule the generic project routes enforce", () => {
  describe("when it is shown the hidden governance kind", () => {
    it("refuses, and says the record is not a workspace", () => {
      expect(
        governanceProjectRouteViolation(PROJECT_KIND.INTERNAL_GOVERNANCE),
      ).toBe(GOVERNANCE_PROJECT_ROUTE_REFUSAL);
    });

    it("names the same kind the governance service mints", () => {
      // The projects app layer spells the value itself so it carries no
      // dependency on the enterprise tree. This is the pin that keeps the two
      // spellings from drifting apart.
      expect(INTERNAL_GOVERNANCE_PROJECT_KIND).toBe(
        PROJECT_KIND.INTERNAL_GOVERNANCE,
      );
    });
  });

  describe("when it is shown an ordinary project", () => {
    it("allows it", () => {
      expect(
        governanceProjectRouteViolation(PROJECT_KIND.APPLICATION),
      ).toBeNull();
      expect(governanceProjectRouteViolation(null)).toBeNull();
      expect(governanceProjectRouteViolation(undefined)).toBeNull();
    });
  });
});

describe("given an organization's hidden governance area", () => {
  describe("when a request tries to archive it as if it were a project", () => {
    /** @scenario "The governance area cannot be archived through the projects API" */
    it("is refused before anything is written", async () => {
      const repo = repoHolding(PROJECT_KIND.INTERNAL_GOVERNANCE);
      const service = new ProjectService(repo);

      await expect(
        service.archive({ id: "project_1", organizationId: ORG }),
      ).rejects.toThrow(GovernanceProjectProtectedError);
      expect(repo.archive).not.toHaveBeenCalled();
    });

    it("says it is an internal record rather than a workspace", async () => {
      const service = new ProjectService(
        repoHolding(PROJECT_KIND.INTERNAL_GOVERNANCE),
      );

      await expect(
        service.archive({ id: "project_1", organizationId: ORG }),
      ).rejects.toThrow(/internal governance record/);
    });
  });

  describe("when a request tries to rename it", () => {
    /** @scenario "The governance area cannot be renamed or moved through the projects API" */
    it("is refused before anything is written", async () => {
      const repo = repoHolding(PROJECT_KIND.INTERNAL_GOVERNANCE);
      const service = new ProjectService(repo);

      await expect(
        service.update({
          id: "project_1",
          organizationId: ORG,
          data: { name: "Renamed" },
        }),
      ).rejects.toThrow(GovernanceProjectProtectedError);
      expect(repo.update).not.toHaveBeenCalled();
    });
  });

  describe("when the request comes from a different organization", () => {
    it("falls through to the repository's own scoping rather than confirming the kind", async () => {
      const repo = {
        getWithTeam: vi.fn().mockResolvedValue({
          id: "project_1",
          kind: PROJECT_KIND.INTERNAL_GOVERNANCE,
          isPersonal: false,
          teamId: "team_z",
          team: { id: "team_z", organizationId: "org_other" },
        }),
        archive: vi.fn().mockResolvedValue(null),
      } as unknown as ProjectRepository;
      const service = new ProjectService(repo);

      // Not the governance refusal — a caller in another organization must not
      // learn what kind of record this id names.
      await expect(
        service.archive({ id: "project_1", organizationId: ORG }),
      ).rejects.not.toThrow(GovernanceProjectProtectedError);
    });
  });
});

describe("given an ordinary project in the same organization", () => {
  describe("when it is renamed or archived", () => {
    /** @scenario "An ordinary project is unaffected by the guard" */
    it("each request succeeds as before", async () => {
      const repo = repoHolding(PROJECT_KIND.APPLICATION);
      const service = new ProjectService(repo);

      await expect(
        service.update({
          id: "project_1",
          organizationId: ORG,
          data: { name: "Renamed" },
        }),
      ).resolves.toBeDefined();
      expect(repo.update).toHaveBeenCalled();
    });
  });
});
