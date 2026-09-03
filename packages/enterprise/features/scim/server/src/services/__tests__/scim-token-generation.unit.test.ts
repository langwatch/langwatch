// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * Minting a SCIM provisioning token, and the two refusals a mint can hit
 * before it ever writes a row: no connection named at all, and a connection
 * that belongs to a different organization.
 */
import { describe, expect, it, vi } from "vitest";
import {
  ScimConnectionNotFoundError,
  ScimConnectionRequiredError,
} from "@langwatch/enterprise-scim-contract";
import { ScimService } from "../scim.service";
import { EntitlementService } from "@langwatch/entitlement-contract";
import type { ScimRepositoryPort } from "../../ports/scim-repository.port";
import { scimRepositoryFixture } from "../../__tests__/support/scim-repository-fixture";
import { QuietScimSyncLifecycle } from "../../ports/__tests__/support/quiet-scim-sync-lifecycle";
import { GrantsFake } from "../../__tests__/support/grants-fake";
import type { ScimUserProvisioning } from "../scim-provisioning.service";

class FixedEntitlementService extends EntitlementService {
  async getActivePlan() {
    return {
      planSource: "free" as const,
      type: "ENTERPRISE",
      name: "Test",
      free: false,
      maxMembers: 1,
      maxMembersLite: 1,
      maxMessagesPerMonth: 1,
      canPublish: false,
      prices: { USD: 0, EUR: 0 },
    };
  }
}

function service(repo: ScimRepositoryPort): ScimService {
  return ScimService.create({
    prisma: repo,
    writer: new GrantsFake(),
    auth: { revokeAllBrowserSessions: vi.fn(async () => undefined) },
    users: {
      tryFindByEmail: vi.fn(async () => null),
      tryFindById: vi.fn(async () => null),
      create: vi.fn(),
      updateProfile: vi.fn(),
      deactivate: vi.fn(),
      reactivate: vi.fn(),
    } satisfies ScimUserProvisioning,
    governance: {
      departmentResolveByNameOrCreate: vi.fn(),
      departmentAssignUser: vi.fn(async () => undefined),
    },
    entitlements: new FixedEntitlementService(),
    lifecycle: new QuietScimSyncLifecycle(),
    provenOffboarding: false,
  });
}

describe("ScimService.generateToken", () => {
  describe("when generating a token", () => {
    describe("given no connection", () => {
      /** @scenario A token cannot exist without a connection to belong to */
      it("refuses with scim_connection_required and writes nothing", async () => {
        const repo = scimRepositoryFixture();
        const scim = service(repo);

        await expect(
          scim.generateToken({ organizationId: "org-1", connectionId: null }),
        ).rejects.toBeInstanceOf(ScimConnectionRequiredError);
        expect(repo.createToken).not.toHaveBeenCalled();
      });
    });

    describe("given a connection belonging to another organization", () => {
      /** @scenario A token cannot be issued against another organization's connection */
      it("refuses as not found, revealing nothing about the other organization", async () => {
        const repo = scimRepositoryFixture({
          scimConnectionExists: vi.fn(async () => false),
        });
        const scim = service(repo);

        await expect(
          scim.generateToken({ organizationId: "org-1", connectionId: "conn-other-org" }),
        ).rejects.toBeInstanceOf(ScimConnectionNotFoundError);
        expect(repo.createToken).not.toHaveBeenCalled();
      });
    });
  });
});
