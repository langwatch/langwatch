// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The one lockout nothing inside the product undoes: a full sync asserts the
 * set the directory knows about and deactivates the rest, and the
 * administrator somebody invited by hand is in nobody's directory.
 *
 * Both write paths ask, because the grants flag chooses HOW access is removed
 * and never whether the organization may be left with nobody to administer
 * it. specs/identity/scim-connection-sync.feature.
 */
import type { EntitlementApi } from "@langwatch/entitlement-contract";
import { CannotRemoveLastAdminError } from "@langwatch/organization-contract";
import type { UserProfile } from "@langwatch/user-contract";
import { describe, expect, it, vi } from "vitest";

import { GrantsFake } from "../../__tests__/support/grants-fake.ts";
import { OrganizationAdministrationFake } from "../../__tests__/support/organization-administration-fake.ts";
import { scimRepositoryFixture } from "../../__tests__/support/scim-repository-fixture.ts";
import type { ScimRepository } from "../../repositories/scim.repository.ts";
import type { ScimDepartmentAssignment } from "../scim-cost-center.service.ts";
import type { ScimUserProvisioning } from "../scim-provisioning.service.ts";
import { ScimService } from "../scim.service.ts";
import { QuietScimSyncLifecycle } from "./support/quiet-scim-sync-lifecycle.ts";

const ORGANIZATION = "org_acme";
const ADMIN = "user_ana";
const CONNECTION = "conn_okta_primary";

const DEACTIVATING_PUSH = {
  schemas: ["urn:ietf:params:scim:schemas:core:2.0:User"],
  userName: "ana@acme.com",
  active: false,
} as const;

const profile: UserProfile = {
  id: ADMIN,
  name: "Ana Admin",
  email: "ana@acme.com",
  emailVerified: true,
  image: null,
  pendingSsoSetup: false,
  createdAt: new Date("2024-01-01T00:00:00Z"),
  updatedAt: new Date("2024-01-02T00:00:00Z"),
  lastLoginAt: null,
  deactivatedAt: null,
};

class EnterprisePlan implements Pick<EntitlementApi, "getActivePlan"> {
  async getActivePlan() {
    return {
      planSource: "free" as const,
      type: "ENTERPRISE",
      name: "Enterprise",
      free: false,
      maxMembers: 1,
      maxMembersLite: 1,
      maxMessagesPerMonth: 1,
      canPublish: true,
      prices: { USD: 0, EUR: 0 },
    };
  }
}

function departments(): ScimDepartmentAssignment {
  return {
    departmentResolveByNameOrCreate: vi.fn(async () => ({
      id: "department_1",
      organizationId: ORGANIZATION,
      name: "Engineering",
      createdAt: new Date(0),
      updatedAt: new Date(0),
    })),
    departmentAssignUser: vi.fn(async () => undefined),
  };
}

function users(): ScimUserProvisioning {
  return {
    findById: vi.fn(async () => profile),
    findByEmail: vi.fn(async () => profile),
    create: vi.fn(async () => profile),
    updateProfile: vi.fn(async () => profile),
    deactivate: vi.fn(async () => ({ ...profile, deactivatedAt: new Date() })),
    reactivate: vi.fn(async () => profile),
  };
}

function directory(): ScimRepository {
  return scimRepositoryFixture({
    findMembership: vi.fn(async () => ({
      userId: ADMIN,
      organizationId: ORGANIZATION,
      role: "ADMIN",
      user: { id: ADMIN, name: profile.name, email: profile.email, deactivatedAt: null },
    })),
  });
}

function stack({ provenOffboarding, refuses }: { provenOffboarding: boolean; refuses: boolean }) {
  const repository = directory();
  const userService = users();
  const writer = new GrantsFake();
  const organization = new OrganizationAdministrationFake();
  if (refuses) {
    organization.assertRemovalKeepsAnAdministrator.mockRejectedValue(
      new CannotRemoveLastAdminError(),
    );
  }

  return {
    repository,
    userService,
    writer,
    organization,
    service: ScimService.create({
      prisma: repository,
      writer,
      users: userService,
      auth: { revokeAllBrowserSessions: vi.fn(async () => undefined) },
      governance: departments(),
      organization,
      entitlements: new EnterprisePlan(),
      lifecycle: new QuietScimSyncLifecycle(),
      provenOffboarding,
    }),
  };
}

describe("given the organization's only administrator", () => {
  describe("when the directory pushes them as inactive through the proven path", () => {
    it("refuses, and leaves them exactly as they were", async () => {
      const { service, userService, writer } = stack({
        provenOffboarding: true,
        refuses: true,
      });

      await expect(
        service.replaceUser({
          id: ADMIN,
          organizationId: ORGANIZATION,
          request: DEACTIVATING_PUSH,
          connectionId: CONNECTION,
        }),
      ).rejects.toMatchObject({ code: "cannot_remove_last_admin" });

      expect(writer.offboard).not.toHaveBeenCalled();
      expect(userService.deactivate).not.toHaveBeenCalled();
    });
  });

  describe("when the grants flag is off", () => {
    /** @scenario "The refusal does not depend on the directory grants flag" */
    it("refuses the deactivating push on the previous write path too", async () => {
      const { service, userService } = stack({ provenOffboarding: false, refuses: true });

      await expect(
        service.replaceUser({
          id: ADMIN,
          organizationId: ORGANIZATION,
          request: DEACTIVATING_PUSH,
          connectionId: CONNECTION,
        }),
      ).rejects.toMatchObject({ code: "cannot_remove_last_admin" });

      expect(userService.deactivate).not.toHaveBeenCalled();
    });

    /** @scenario "The refusal does not depend on the directory grants flag" */
    it("refuses a deletion before the membership row goes", async () => {
      const { service, repository, writer, userService } = stack({
        provenOffboarding: false,
        refuses: true,
      });

      await expect(
        service.deleteUser({
          id: ADMIN,
          organizationId: ORGANIZATION,
          connectionId: CONNECTION,
        }),
      ).rejects.toMatchObject({ code: "cannot_remove_last_admin" });

      expect(writer.offboardMember).not.toHaveBeenCalled();
      expect(repository.removeMembership).not.toHaveBeenCalled();
      expect(userService.deactivate).not.toHaveBeenCalled();
    });
  });
});

describe("given somebody whose removal costs the organization no administrator", () => {
  it("is deleted without the guard having an opinion", async () => {
    const { service, repository, organization } = stack({
      provenOffboarding: false,
      refuses: false,
    });

    await service.deleteUser({
      id: ADMIN,
      organizationId: ORGANIZATION,
      connectionId: CONNECTION,
    });

    expect(organization.assertRemovalKeepsAnAdministrator).toHaveBeenCalledWith({
      organizationId: ORGANIZATION,
      userId: ADMIN,
    });
    expect(repository.removeMembership).toHaveBeenCalled();
  });
});
