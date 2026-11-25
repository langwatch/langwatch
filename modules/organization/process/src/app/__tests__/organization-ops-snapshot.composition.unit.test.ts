/**
 * The staff investigation snapshot through `OrganizationModule.create` over the memory registry:
 * ids, counts and the creation time of one organization, and nothing that names a person.
 * @see dev/docs/adr/202-ops-agent-access.md
 */
import { nowInstant } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { MemoryOrganizationDatabase } from "../../repositories/memory/memory.organization.database.ts";
import { TestAuthzApi } from "../../transport/__tests__/support/test-authz-api.ts";
import { OrganizationModule } from "../organization.app.ts";
import { organizationModuleSetup, seedMemoryProject } from "./support/organization-module-setup.ts";

const ORGANIZATION_ID = "org-1";
const ADMIN = { id: "user-admin" };
const MEMBER = { id: "user-member" };

/** An organization with two members, one pending and one revoked invite, and two projects. */
async function application() {
  const permissions = TestAuthzApi.create({
    people: [
      { id: ADMIN.id, name: "Ana", email: "ana@acme.test" },
      { id: MEMBER.id, name: "Bruno", email: "bruno@acme.test" },
    ],
  });
  const memory = MemoryOrganizationDatabase.create();
  const setup = organizationModuleSetup({ permissions, memory });
  await setup.repositories.membership(permissions).createAndAssign({
    userId: ADMIN.id,
    orgId: ORGANIZATION_ID,
    orgName: "ACME",
    orgSlug: "acme",
    teamId: "team-1",
    teamSlug: "engineering",
    pricingModel: "SEAT_EVENT",
  });
  const at = nowInstant();
  memory.users.set(MEMBER.id, {
    id: MEMBER.id,
    name: "Bruno",
    email: "bruno@acme.test",
    deactivatedAt: null,
  });
  memory.organizationUsers.push({
    userId: MEMBER.id,
    organizationId: ORGANIZATION_ID,
    role: "MEMBER",
    disabledAt: null,
    createdAt: at,
    updatedAt: at,
  });
  for (const [id, status] of [
    ["invite-pending", "PENDING"],
    ["invite-revoked", "REVOKED"],
  ] as const) {
    memory.invites.set(id, {
      id,
      email: `${id}@acme.test`,
      inviteCode: `code-${id}`,
      expiration: at.add({ hours: 48 }),
      status,
      organizationId: ORGANIZATION_ID,
      teamIds: "team-1",
      teamAssignments: null,
      role: "MEMBER",
      requestedBy: null,
      subscriptionId: null,
      acceptedByUserId: null,
      acceptedViaIdentifierId: null,
      createdAt: at,
      updatedAt: at,
    });
  }
  for (const id of ["project-b", "project-a"]) {
    seedMemoryProject({ memory, id, name: id, teamId: "team-1", organizationId: ORGANIZATION_ID });
  }
  return { app: await OrganizationModule.create(setup), memory };
}

describe("OrganizationModule.getOpsSnapshot", () => {
  describe("given a seeded organization", () => {
    it("answers its ids, counts and creation time", async () => {
      const { app, memory } = await application();
      const createdAt = memory.organizations.get(ORGANIZATION_ID)?.createdAt.epochMilliseconds;

      await expect(app.getOpsSnapshot({ organizationId: ORGANIZATION_ID })).resolves.toEqual({
        organizationId: ORGANIZATION_ID,
        createdAt,
        membersCount: 2,
        pendingInvitesCount: 1,
        teamsCount: 1,
        projectIds: ["project-a", "project-b"],
      });
    });

    it("carries no name, slug or address", async () => {
      const { app } = await application();

      const text = JSON.stringify(await app.getOpsSnapshot({ organizationId: ORGANIZATION_ID }));

      for (const word of ["ACME", "acme", "Ana", "Bruno", "engineering", "@"]) {
        expect(text).not.toContain(word);
      }
    });
  });

  describe("when the organization does not exist", () => {
    it("refuses with organization_not_found", async () => {
      const { app } = await application();

      await expect(app.getOpsSnapshot({ organizationId: "org-missing" })).rejects.toMatchObject({
        code: "organization_not_found",
      });
    });
  });
});
