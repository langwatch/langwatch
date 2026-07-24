import type { Organization, Project, Team, User } from "@prisma/client";
import { describe, expect, it } from "vitest";
import {
  mapUserToBackofficeRow,
  type UserWithBackofficeIncludes,
} from "../userVisibility";

/**
 * Pins the Backoffice Users list's project-visibility rule: a user who has
 * an OrganizationUser but NO TeamUser must still see every non-archived
 * project in every team of those orgs — same rule the main app applies in
 * `organization.prisma.repository.ts#getAllForUser`. Regression coverage
 * for commit 605ab6ccb, where the Backoffice previously walked
 * teamMemberships and rendered an empty Projects column for exactly that
 * cohort.
 */

function buildUser(
  overrides: Partial<UserWithBackofficeIncludes> = {},
): UserWithBackofficeIncludes {
  return {
    id: "user_1",
    name: "Test User",
    email: "test@example.com",
    image: null,
    emailVerified: null,
    pendingSsoSetup: false,
    createdAt: new Date("2026-01-01"),
    updatedAt: new Date("2026-01-01"),
    lastLoginAt: null,
    deactivatedAt: null,
    orgMemberships: [],
    ...overrides,
  } as UserWithBackofficeIncludes;
}

type OrgWithTeams = Organization & {
  teams: (Team & { projects: Project[] })[];
};

function buildOrg(overrides: Partial<OrgWithTeams> = {}): OrgWithTeams {
  return {
    id: "org_1",
    name: "Acme",
    slug: "acme",
    teams: [],
    ...overrides,
  } as unknown as OrgWithTeams;
}

function buildTeam(
  overrides: Partial<Team & { projects: Project[] }> = {},
): Team & { projects: Project[] } {
  return {
    id: "team_1",
    name: "Engineering",
    slug: "engineering",
    organizationId: "org_1",
    archivedAt: null,
    projects: [],
    ...overrides,
  } as unknown as Team & { projects: Project[] };
}

function buildProject(overrides: Partial<Project> = {}): Project {
  return {
    id: "project_1",
    name: "Ingest",
    slug: "ingest",
    teamId: "team_1",
    archivedAt: null,
    ...overrides,
  } as unknown as Project;
}

describe("mapUserToBackofficeRow", () => {
  describe("given a user with an org membership but no team membership", () => {
    it("still surfaces every project in the org's teams", () => {
      // No TeamUser rows anywhere — only the organization membership.
      // The previous implementation walked teamMemberships and would
      // return an empty projects array here; the fix has to traverse
      // org → teams → projects so this user still sees the project.
      const project = buildProject({ id: "p_visible", name: "Visible" });
      const team = buildTeam({ projects: [project] });
      const org = buildOrg({ teams: [team] });

      const row = mapUserToBackofficeRow(
        buildUser({ orgMemberships: [{ organization: org }] }),
      );

      expect(row.organizations).toEqual([{ id: org.id, name: org.name }]);
      expect(row.projects).toEqual([
        { id: project.id, name: project.name, slug: project.slug },
      ]);
    });
  });

  describe("given a user with overlapping memberships across orgs", () => {
    it("dedupes orgs and projects so each chip appears once", () => {
      const shared = buildProject({ id: "p_shared", name: "Shared" });
      const orgA = buildOrg({
        id: "org_a",
        name: "A",
        teams: [buildTeam({ id: "team_a", projects: [shared] })],
      });
      const orgB = buildOrg({
        id: "org_b",
        name: "B",
        teams: [
          buildTeam({
            id: "team_b",
            organizationId: "org_b",
            projects: [shared], // same project id showing up via a second membership
          }),
        ],
      });

      const row = mapUserToBackofficeRow(
        buildUser({
          orgMemberships: [
            { organization: orgA },
            { organization: orgB },
            { organization: orgA }, // duplicate membership row — must not double-count
          ],
        }),
      );

      expect(row.organizations.map((o) => o.id)).toEqual(["org_a", "org_b"]);
      expect(row.projects.map((p) => p.id)).toEqual(["p_shared"]);
    });
  });

  describe("given a user with no memberships", () => {
    it("returns empty organization and project lists", () => {
      const row = mapUserToBackofficeRow(buildUser());
      expect(row.organizations).toEqual([]);
      expect(row.projects).toEqual([]);
    });
  });

  describe("given a team with an empty projects relation", () => {
    it("does not blow up and returns no projects for that team", () => {
      const org = buildOrg({
        teams: [buildTeam({ projects: [] })],
      });

      const row = mapUserToBackofficeRow(
        buildUser({ orgMemberships: [{ organization: org }] }),
      );

      expect(row.projects).toEqual([]);
      expect(row.organizations).toHaveLength(1);
    });
  });

  describe("given an org that archives a project via the Prisma where clause", () => {
    it("only receives non-archived projects (enforced upstream by the include)", () => {
      // The include filters `archivedAt: null` at the Prisma level, so by
      // the time this mapper runs an archived project should never be in
      // the input. Assert the mapper faithfully reflects whatever Prisma
      // gave it — i.e., it does not re-introduce archived rows.
      const alive = buildProject({ id: "p_alive", archivedAt: null });
      const org = buildOrg({
        teams: [buildTeam({ projects: [alive] })],
      });

      const row = mapUserToBackofficeRow(
        buildUser({ orgMemberships: [{ organization: org }] }),
      );

      expect(row.projects.map((p) => p.id)).toEqual(["p_alive"]);
    });
  });
});
