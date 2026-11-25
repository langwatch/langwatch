/**
 * @vitest-environment node
 * The support contact `/me` shows: the one configured, else the longest-seated enabled admin.
 * @see modules/organization/specs/organization-service.feature
 */
import type { AuthzApi } from "@langwatch/authz-contract";
import { OrganizationUserRole } from "@langwatch/organization-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { Temporal } from "@langwatch/time";
import { beforeEach, describe, expect, it } from "vitest";

import type { GroupIdentity } from "../../features/group/services/group-identity.service.ts";
import type { PersonalWorkspaceIdentity } from "../../features/personal-workspace/services/personal-workspace-identity.service.ts";
import type { GroupRepository } from "../../repositories/group.repository.ts";
import { MemoryOrganizationDatabase } from "../../repositories/memory/memory.organization.database.ts";
import { MemoryOrganizationRepository } from "../../repositories/memory/memory.organization.repository.ts";
import type { TeamRepository } from "../../repositories/team.repository.ts";
import { OrganizationService } from "../organization.service.ts";
import type { TeamIdentity } from "../team-identity.service.ts";

const T0 = Temporal.Instant.from("2026-09-01T00:00:00Z");
const at = (days: number) => T0.add({ hours: 24 * days });

let database: MemoryOrganizationDatabase;

function seedOrganization(supportContact: string | null): void {
  database.organizations.set("org_acme", {
    id: "org_acme",
    name: "ACME",
    slug: "acme",
    supportContact,
    presenceEnabled: false,
    traceSharingEnabled: false,
    primaryIntent: null,
    s3Endpoint: null,
    s3AccessKeyId: null,
    s3SecretAccessKey: null,
    s3Bucket: null,
    stripeCustomerId: null,
    createdAt: T0,
    updatedAt: T0,
  });
}

function seat(input: {
  userId: string;
  role: OrganizationUserRole;
  seatedDays: number;
  disabled?: boolean;
}): void {
  database.users.set(input.userId, {
    id: input.userId,
    name: input.userId,
    email: `${input.userId}@acme.test`,
    deactivatedAt: null,
  });
  database.organizationUsers.push({
    userId: input.userId,
    organizationId: "org_acme",
    role: input.role,
    disabledAt: input.disabled ? at(input.seatedDays + 1) : null,
    createdAt: at(input.seatedDays),
    updatedAt: at(input.seatedDays),
  });
}

function service(): OrganizationService {
  const authz = createApiFixture<AuthzApi>();
  return OrganizationService.create({
    repository: MemoryOrganizationRepository.create({ memory: database }),
    teams: createApiFixture<TeamRepository>(),
    groups: createApiFixture<GroupRepository>(),
    identities: createApiFixture<PersonalWorkspaceIdentity>(),
    teamIdentities: createApiFixture<TeamIdentity>(),
    groupIdentities: createApiFixture<GroupIdentity>(),
    authz,
    grants: authz,
  });
}

beforeEach(() => {
  database = MemoryOrganizationDatabase.create();
});

describe("finding an organization's support contact", () => {
  describe("given an organization whose settings name a support contact", () => {
    describe("when its support contact is found", () => {
      /** @scenario "An organization's support contact is the one set in its settings, else its longest-seated enabled administrator" */
      it("answers the configured contact, else the earliest enabled administrator, else none", async () => {
        seedOrganization("help@acme.test");
        seat({ userId: "ada", role: OrganizationUserRole.ADMIN, seatedDays: 1 });
        expect(await service().findSupportContact({ organizationId: "org_acme" })).toBe(
          "help@acme.test",
        );

        database = MemoryOrganizationDatabase.create();
        seedOrganization(null);
        seat({ userId: "gone", role: OrganizationUserRole.ADMIN, seatedDays: 0, disabled: true });
        seat({ userId: "member", role: OrganizationUserRole.MEMBER, seatedDays: 0 });
        seat({ userId: "late", role: OrganizationUserRole.ADMIN, seatedDays: 5 });
        seat({ userId: "early", role: OrganizationUserRole.ADMIN, seatedDays: 2 });
        expect(await service().findSupportContact({ organizationId: "org_acme" })).toBe(
          "early@acme.test",
        );

        database = MemoryOrganizationDatabase.create();
        seedOrganization(null);
        seat({ userId: "gone", role: OrganizationUserRole.ADMIN, seatedDays: 0, disabled: true });
        expect(await service().findSupportContact({ organizationId: "org_acme" })).toBeNull();
      });
    });
  });
});
