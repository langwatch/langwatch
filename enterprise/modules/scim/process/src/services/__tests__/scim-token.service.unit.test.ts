// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The token half of `ScimService`, where a mint binds a connection, a
 * teardown ends one connection's sync and nobody else's, and an exercise
 * asks the plan about the organization the token itself names.
 */
import { createHash } from "node:crypto";

import type { EntitlementApi } from "@langwatch/entitlement-contract";
import { describe, expect, it, vi } from "vitest";

import { GrantsFake } from "../../__tests__/support/grants-fake.ts";
import { OrganizationAdministrationFake } from "../../__tests__/support/organization-administration-fake.ts";
import { scimRepositoryFixture } from "../../__tests__/support/scim-repository-fixture.ts";
import type { ScimRepository } from "../../repositories/scim.repository.ts";
import type { ScimUserProvisioning } from "../scim-provisioning.service.ts";
import { ScimService } from "../scim.service.ts";
import { QuietScimSyncLifecycle } from "./support/quiet-scim-sync-lifecycle.ts";

class RecordingScimSyncLifecycle extends QuietScimSyncLifecycle {
  tokenIssued = vi.fn(async () => undefined);
  revoked = vi.fn(async () => undefined);
}

function entitlementsOn(type: string): Pick<EntitlementApi, "getActivePlan"> & {
  getActivePlan: ReturnType<typeof vi.fn>;
} {
  return {
    getActivePlan: vi.fn(async () => ({
      planSource: "free" as const,
      type,
      name: "Test",
      free: false,
      maxMembers: 1,
      maxMembersLite: 1,
      maxMessagesPerMonth: 1,
      canPublish: false,
      prices: { USD: 0, EUR: 0 },
    })),
  };
}

function service(
  repository: ScimRepository,
  lifecycle: RecordingScimSyncLifecycle,
  entitlements: Pick<EntitlementApi, "getActivePlan">,
): ScimService {
  return ScimService.create({
    prisma: repository,
    writer: new GrantsFake(),
    auth: { revokeAllBrowserSessions: vi.fn(async () => undefined) },
    users: {
      findByEmail: vi.fn(async () => null),
      findById: vi.fn(async () => null),
      create: vi.fn(),
      updateProfile: vi.fn(),
      deactivate: vi.fn(),
      reactivate: vi.fn(),
    } satisfies ScimUserProvisioning,
    governance: {
      departmentResolveByNameOrCreate: vi.fn(),
      departmentAssignUser: vi.fn(async () => undefined),
    },
    organization: new OrganizationAdministrationFake(),
    entitlements,
    lifecycle,
    provenOffboarding: false,
  });
}

describe("ScimService token operations", () => {
  describe("when a token is minted", () => {
    it("binds it to exactly one connection, on the row and on the history", async () => {
      const repository = scimRepositoryFixture({
        createToken: vi.fn(async () => ({ id: "token_1" })),
      });
      const lifecycle = new RecordingScimSyncLifecycle();

      const minted = await service(
        repository,
        lifecycle,
        entitlementsOn("ENTERPRISE"),
      ).generateToken({
        organizationId: "org_1",
        connectionId: "okta-primary",
        description: "Okta",
      });

      expect(minted).toEqual({
        token: expect.any(String),
        tokenId: "token_1",
        connectionId: "okta-primary",
      });
      expect(repository.createToken).toHaveBeenCalledWith({
        organizationId: "org_1",
        connectionId: "okta-primary",
        hashedToken: expect.any(String),
        description: "Okta",
      });
      expect(lifecycle.tokenIssued).toHaveBeenCalledWith({
        organizationId: "org_1",
        connectionId: "okta-primary",
        tokenId: "token_1",
      });
    });

    it("hands the value back once and writes it nowhere", async () => {
      const repository = scimRepositoryFixture({
        createToken: vi.fn(async () => ({ id: "token_1" })),
      });

      const minted = await service(
        repository,
        new RecordingScimSyncLifecycle(),
        entitlementsOn("ENTERPRISE"),
      ).generateToken({ organizationId: "org_1", connectionId: "okta-primary" });

      expect(minted.token).toMatch(/^[0-9a-f]{64}$/);
      const written = vi.mocked(repository.createToken).mock.calls[0]![0];
      expect(Object.values(written)).not.toContain(minted.token);
      expect(written.hashedToken).not.toContain(minted.token);
    });
  });

  describe("when a connection is torn down", () => {
    /** @scenario "Tearing a connection down ends its tokens" */
    it("revokes that connection's tokens only, and ends that connection's sync", async () => {
      const revokeTokensForConnection = vi.fn(async () => 2);
      const repository = scimRepositoryFixture({ revokeTokensForConnection });
      const lifecycle = new RecordingScimSyncLifecycle();

      const result = await service(
        repository,
        lifecycle,
        entitlementsOn("ENTERPRISE"),
      ).revokeTokensForConnection({ organizationId: "org_1", connectionId: "okta-primary" });

      expect(result).toEqual({ revoked: 2 });
      // Scoped to the one connection, which is what leaves a sibling
      // connection of the same organization syncing.
      expect(revokeTokensForConnection).toHaveBeenCalledWith({
        organizationId: "org_1",
        connectionId: "okta-primary",
      });
      expect(lifecycle.revoked).toHaveBeenCalledWith({
        organizationId: "org_1",
        connectionId: "okta-primary",
        tokenId: null,
        cause: "teardown",
      });
    });
  });

  describe("when a token that predates connections is revoked", () => {
    it("succeeds and ends no connection's sync", async () => {
      const repository = scimRepositoryFixture({
        findToken: vi.fn(async () => ({
          id: "token_1",
          organizationId: "org_1",
          connectionId: null,
        })),
        revokeToken: vi.fn(async () => true),
      });
      const lifecycle = new RecordingScimSyncLifecycle();

      const result = await service(repository, lifecycle, entitlementsOn("ENTERPRISE")).revokeToken(
        {
          organizationId: "org_1",
          tokenId: "token_1",
        },
      );

      expect(result).toEqual({ success: true });
      expect(lifecycle.revoked).not.toHaveBeenCalled();
    });
  });

  describe("when a token is exercised", () => {
    it("refuses an unknown value without asking anybody's plan", async () => {
      const findTokenByHash = vi.fn(async () => null);
      const repository = scimRepositoryFixture({ findTokenByHash });
      const entitlements = entitlementsOn("ENTERPRISE");

      const result = await service(
        repository,
        new RecordingScimSyncLifecycle(),
        entitlements,
      ).verifyToken({ token: "not-a-token" });

      expect(result).toEqual({ status: "invalid_token" });
      expect(entitlements.getActivePlan).not.toHaveBeenCalled();
      expect(findTokenByHash).toHaveBeenCalled();
      expect(findTokenByHash).not.toHaveBeenCalledWith("not-a-token");
    });

    it("asks the plan about the organization the token names, not the caller's", async () => {
      const findTokenByHash = vi.fn(async () => ({
        id: "token_1",
        organizationId: "org_1",
        connectionId: "okta-primary",
      }));
      const repository = scimRepositoryFixture({ findTokenByHash });
      const entitlements = entitlementsOn("ENTERPRISE");

      const result = await service(
        repository,
        new RecordingScimSyncLifecycle(),
        entitlements,
      ).verifyToken({ token: "valid-token" });

      expect(result).toEqual({
        status: "ok",
        id: "token_1",
        organizationId: "org_1",
        connectionId: "okta-primary",
      });
      expect(entitlements.getActivePlan).toHaveBeenCalledWith({ organizationId: "org_1" });
      expect(findTokenByHash).toHaveBeenCalledWith(
        createHash("sha256").update("valid-token").digest("hex"),
      );
    });
  });
});
