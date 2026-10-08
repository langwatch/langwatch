/**
 * @vitest-environment node
 * ADR-175 decision 5: every page that lists a team's projects lists an
 * aggregate to an organisation administrator and to nobody else, whatever the
 * route's own permission lets through. The governance project is never listed.
 */
import { PROJECT_KIND } from "@langwatch/project-contract";
import { describe, expect, it } from "vitest";

import { MemoryOrganizationDatabase } from "../../repositories/memory/memory.organization.database.ts";
import { TestAuthzApi } from "../../transport/__tests__/support/test-authz-api.ts";
import {
  ORGANIZATION_ID,
  USER_ID,
  mountTeamsRestApplication,
} from "../../transport/__tests__/team.rest.harness.ts";
import { OrganizationModule } from "../organization.app.ts";
import { organizationModuleSetup, seedMemoryProject } from "./support/organization-module-setup.ts";

const TEAM_ID = "team_shared";
const TEAM_SLUG = "shared-team";
const COLLEAGUE_ID = "user-colleague";
const BOUND_ADMIN_ID = "user-bound-admin";

/**
 * A shared team with an ordinary project, an aggregate and the governance project.
 * The owner's row says administrator; the colleague and the bound administrator
 * hold member rows, and the bound administrator holds an ADMIN binding as well.
 */
async function application() {
  const permissions = TestAuthzApi.create();
  for (const userId of [USER_ID, COLLEAGUE_ID, BOUND_ADMIN_ID]) {
    permissions.seedTeamBinding({
      id: `binding-${userId}`,
      organizationId: ORGANIZATION_ID,
      teamId: TEAM_ID,
      userId,
      role: userId === USER_ID ? "ADMIN" : "MEMBER",
    });
  }
  permissions.seedOrganizationBinding({
    id: "binding-bound-admin-organization",
    organizationId: ORGANIZATION_ID,
    userId: BOUND_ADMIN_ID,
    role: "ADMIN",
  });

  const memory = MemoryOrganizationDatabase.create();
  for (const kind of [
    PROJECT_KIND.APPLICATION,
    PROJECT_KIND.AGGREGATE,
    PROJECT_KIND.INTERNAL_GOVERNANCE,
  ]) {
    seedMemoryProject({
      memory,
      id: `project_${kind}`,
      name: kind,
      teamId: TEAM_ID,
      organizationId: ORGANIZATION_ID,
      kind,
    });
  }
  const setup = organizationModuleSetup({ permissions, memory });
  const membership = setup.repositories.membership(permissions);
  await membership.createAndAssign({
    userId: USER_ID,
    orgId: ORGANIZATION_ID,
    orgName: "ACME",
    orgSlug: "acme",
    teamId: TEAM_ID,
    teamSlug: TEAM_SLUG,
    pricingModel: "SEAT_EVENT",
  });
  for (const userId of [COLLEAGUE_ID, BOUND_ADMIN_ID]) {
    await membership.createMembership({
      organizationId: ORGANIZATION_ID,
      userId,
      pendingAdmissionId: `admission-${userId}`,
      via: "invite",
      seat: "MEMBER",
      pending: false,
    });
  }

  return OrganizationModule.create(setup);
}

const ORDINARY_ONLY = [`project_${PROJECT_KIND.APPLICATION}`];
const WITH_AGGREGATE = [`project_${PROJECT_KIND.APPLICATION}`, `project_${PROJECT_KIND.AGGREGATE}`];

const idsOf = (projects: readonly { id: string }[]) => projects.map(({ id }) => id).toSorted();

describe("given a team holding an ordinary project, an aggregate and the governance project", () => {
  describe.each([
    ["an administrator by membership row", USER_ID, WITH_AGGREGATE],
    ["an administrator by organisation binding", BOUND_ADMIN_ID, WITH_AGGREGATE],
    ["a member who is not an administrator", COLLEAGUE_ID, ORDINARY_ONLY],
  ])("when %s reads the team pages", (_label, userId, expected) => {
    it("lists the team's projects on the teams page accordingly", async () => {
      const app = await application();

      const teams = await app.listTeamsWithProjects(
        { organizationId: ORGANIZATION_ID },
        { id: userId },
      );

      expect(idsOf(teams.flatMap((team) => team.projects))).toEqual(expected.toSorted());
    });

    it("lists the team's projects on the one-team page accordingly", async () => {
      const app = await application();

      const team = await app.getTeamWithProjects(
        { organizationId: ORGANIZATION_ID, slug: TEAM_SLUG },
        { id: userId },
      );

      expect(idsOf(team.projects)).toEqual(expected.toSorted());
    });

    it("lists the team's projects in the access matrix accordingly", async () => {
      const app = await application();

      const matrix = await app.listTeamAccessMatrix(
        { organizationId: ORGANIZATION_ID },
        { id: userId },
      );

      expect(idsOf(matrix.flatMap((team) => team.projects))).toEqual(expected.toSorted());
    });
  });

  describe("when the team's projects are listed over the management API", () => {
    it.each([
      ["a key its administrator owns", { type: "user" as const, id: USER_ID }, WITH_AGGREGATE],
      ["a key a member owns", { type: "user" as const, id: COLLEAGUE_ID }, ORDINARY_ONLY],
      ["a service key that acts for nobody", null, ORDINARY_ONLY],
    ])("lists the projects %s may see", async (_label, actor, expected) => {
      const { send } = mountTeamsRestApplication(await application(), { actor });

      const response = await send(`/api/teams/${TEAM_ID}/projects`);

      expect(response.status).toBe(200);
      const body = (await response.json()) as { data: { id: string }[] };
      expect(idsOf(body.data)).toEqual(expected.toSorted());
    });
  });
});
