/**
 * @vitest-environment node
 *
 * ADR-175: the project an accepted invitation lands on is never an aggregate,
 * which an admin opens on purpose, nor the governance project, which no one sees.
 */
import type { OrganizationInvite } from "@langwatch/organization-contract";
import { PROJECT_KIND } from "@langwatch/project-contract";
import { Temporal } from "@langwatch/time";
import { describe, expect, it } from "vitest";

import { MemoryOrganizationInviteRepository } from "../../../../repositories/memory/memory.organization-invite.repository.ts";
import { MemoryOrganizationDatabase } from "../../../../repositories/memory/memory.organization.database.ts";
import { InviteService } from "../invite.service.ts";
import { makeInviteDeps } from "./support/invite-fakes.ts";

const ORGANIZATION_ID = "org-1";
const T0 = Temporal.Instant.fromEpochMilliseconds(0);

function seedTeam(memory: MemoryOrganizationDatabase, teamId: string): void {
  memory.teams.set(teamId, {
    id: teamId,
    name: teamId,
    slug: teamId,
    organizationId: ORGANIZATION_ID,
    isPersonal: false,
    ownerUserId: null,
    archivedAt: null,
    createdAt: T0,
    updatedAt: T0,
  });
}

function seedProject(
  memory: MemoryOrganizationDatabase,
  { slug, teamId, kind }: { slug: string; teamId: string; kind: string },
): void {
  memory.projects.set(slug, {
    id: slug,
    name: slug,
    slug,
    apiKey: `sk-lw-${slug}`,
    kind,
    teamId,
    isPersonal: false,
    ownerUserId: null,
    organizationId: ORGANIZATION_ID,
    archivedAt: null,
    createdAt: T0,
    updatedAt: T0,
    personalFeatures: null,
  });
}

function invitation(teamIds: string): OrganizationInvite {
  return {
    id: "invite-1",
    email: "invited@acme.test",
    inviteCode: "code-1",
    expiration: null,
    status: "PENDING",
    organizationId: ORGANIZATION_ID,
    teamIds,
    teamAssignments: null,
    role: "ADMIN",
    requestedBy: null,
    subscriptionId: null,
    acceptedByUserId: null,
    acceptedViaIdentifierId: null,
    createdAt: T0,
    updatedAt: T0,
  };
}

/** The landing candidates for an admin invited to `view-team`, over the memory tables. */
async function landingSlugs(memory: MemoryOrganizationDatabase): Promise<string[]> {
  const service = InviteService.create(
    makeInviteDeps({ invites: MemoryOrganizationInviteRepository.create({ memory }) }),
  );

  return service.findLandingProjectSlugs(invitation("view-team"));
}

describe("given an admin invited to a team whose only projects are an aggregate and the governance project", () => {
  describe("when the app picks where the accepted invitation lands", () => {
    /** @scenario "Neither an aggregate nor the governance project is ever the project the app lands on" */
    it("lands on an ordinary project elsewhere in the organisation", async () => {
      const memory = MemoryOrganizationDatabase.create();
      seedTeam(memory, "view-team");
      seedTeam(memory, "shared-team");
      seedProject(memory, { slug: "view", teamId: "view-team", kind: PROJECT_KIND.AGGREGATE });
      seedProject(memory, {
        slug: "governance",
        teamId: "view-team",
        kind: PROJECT_KIND.INTERNAL_GOVERNANCE,
      });
      seedProject(memory, {
        slug: "ordinary",
        teamId: "shared-team",
        kind: PROJECT_KIND.APPLICATION,
      });

      await expect(landingSlugs(memory)).resolves.toEqual(["ordinary"]);
    });
  });
});

describe("given an admin invited to a team holding an ordinary project beside an aggregate", () => {
  describe("when the app picks where the accepted invitation lands", () => {
    /** @scenario "Neither an aggregate nor the governance project is ever the project the app lands on" */
    it("offers only the ordinary project of the invited team", async () => {
      const memory = MemoryOrganizationDatabase.create();
      seedTeam(memory, "view-team");
      seedProject(memory, { slug: "view", teamId: "view-team", kind: PROJECT_KIND.AGGREGATE });
      seedProject(memory, {
        slug: "ordinary",
        teamId: "view-team",
        kind: PROJECT_KIND.APPLICATION,
      });

      await expect(landingSlugs(memory)).resolves.toEqual(["ordinary"]);
    });
  });
});
