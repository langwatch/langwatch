// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * A directory token from the minute it is minted to the minute it is revoked:
 * the value is handed out once, the store never holds it, and a revoked token
 * stops verifying. `ScimService` runs over the in-memory SCIM store.
 * @see specs/organizations/scim-tokens-rest-api.feature
 */
import type { EntitlementApi } from "@langwatch/entitlement-contract";
import { describe, expect, it, vi } from "vitest";

import { GrantsFake } from "../../__tests__/support/grants-fake.ts";
import { OrganizationAdministrationFake } from "../../__tests__/support/organization-administration-fake.ts";
import { MemoryScimRepository } from "../../repositories/memory/memory.scim.repository.ts";
import type { ScimUserProvisioning } from "../scim-provisioning.service.ts";
import { ScimService } from "../scim.service.ts";
import { QuietScimSyncLifecycle } from "./support/quiet-scim-sync-lifecycle.ts";

const ORGANIZATION = "org_acme";
const CONNECTION = "ssoc_okta";

class SwitchablePlan implements Pick<EntitlementApi, "getActivePlan"> {
  type = "ENTERPRISE";

  async getActivePlan() {
    return {
      planSource: "free" as const,
      type: this.type,
      name: "Enterprise",
      free: false,
      maxMembers: 10,
      maxMembersLite: 10,
      maxMessagesPerMonth: 1,
      canPublish: true,
      prices: { USD: 0, EUR: 0 },
    };
  }
}

function directory() {
  const plan = new SwitchablePlan();
  const store = MemoryScimRepository.create();
  store.connections.push({ organizationId: ORGANIZATION, connectionId: CONNECTION });
  const service = ScimService.create({
    prisma: store,
    writer: new GrantsFake(),
    users: {
      findById: vi.fn(async () => null),
      findByEmail: vi.fn(async () => null),
      create: vi.fn(),
    } satisfies ScimUserProvisioning,
    governance: {
      departmentResolveByNameOrCreate: vi.fn(),
      departmentAssignUser: vi.fn(async () => undefined),
    },
    organization: new OrganizationAdministrationFake(),
    entitlements: plan,
    lifecycle: new QuietScimSyncLifecycle(),
    provenOffboarding: false,
    tokenPepper: "scim-test-pepper",
  });

  return { store, service, plan };
}

describe("a directory token", () => {
  describe("when the plan it was minted under lapses", () => {
    /** @scenario "A SCIM bearer token stops working when the plan lapses" */
    it("stops verifying as entitled, naming the organization it belongs to", async () => {
      const { service, plan } = directory();
      const minted = await service.generateToken({
        organizationId: ORGANIZATION,
        connectionId: CONNECTION,
      });
      await expect(service.verifyToken({ token: minted.token })).resolves.toMatchObject({
        status: "ok",
      });

      plan.type = "FREE";

      await expect(service.verifyToken({ token: minted.token })).resolves.toEqual({
        status: "plan_not_entitled",
        organizationId: ORGANIZATION,
        connectionId: CONNECTION,
      });
    });
  });

  describe("when it is created", () => {
    /** @scenario Creating a SCIM token returns the secret exactly once */
    it("verifies as the connection's token, and listing afterwards never repeats the value", async () => {
      const { service } = directory();

      const minted = await service.generateToken({
        organizationId: ORGANIZATION,
        connectionId: CONNECTION,
        description: "Okta production",
      });

      await expect(service.verifyToken({ token: minted.token })).resolves.toEqual({
        status: "ok",
        id: minted.tokenId,
        organizationId: ORGANIZATION,
        connectionId: CONNECTION,
      });
      const listed = await service.listTokens({ organizationId: ORGANIZATION });
      expect(listed).toEqual([
        expect.objectContaining({ id: minted.tokenId, description: "Okta production" }),
      ]);
      expect(JSON.stringify(listed)).not.toContain(minted.token);
    });
  });

  describe("when it is revoked", () => {
    /** @scenario Revoking a SCIM token stops it verifying */
    it("stops verifying, and revoking it again is refused as not found", async () => {
      const { service } = directory();
      const minted = await service.generateToken({
        organizationId: ORGANIZATION,
        connectionId: CONNECTION,
      });
      await expect(service.verifyToken({ token: minted.token })).resolves.toMatchObject({
        status: "ok",
      });

      await expect(
        service.revokeToken({ organizationId: ORGANIZATION, tokenId: minted.tokenId }),
      ).resolves.toEqual({ success: true });

      await expect(service.verifyToken({ token: minted.token })).resolves.toEqual({
        status: "invalid_token",
      });
      await expect(
        service.revokeToken({ organizationId: ORGANIZATION, tokenId: minted.tokenId }),
      ).rejects.toMatchObject({ code: "scim_token_not_found", httpStatus: 404 });
    });
  });
});
