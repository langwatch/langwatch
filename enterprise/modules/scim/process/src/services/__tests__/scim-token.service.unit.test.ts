// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * The token half of `ScimService`, where a mint binds a connection, a
 * teardown ends one connection's sync and nobody else's, and an exercise
 * asks the plan about the organization the token itself names.
 */
import { createHash, createHmac } from "node:crypto";

import type { EntitlementApi } from "@langwatch/entitlement-contract";
import { describe, expect, it, vi } from "vitest";

import { GrantsFake } from "../../__tests__/support/grants-fake.ts";
import { OrganizationAdministrationFake } from "../../__tests__/support/organization-administration-fake.ts";
import { scimRepositoryFixture } from "../../__tests__/support/scim-repository-fixture.ts";
import { MemoryScimRepository } from "../../repositories/memory/memory.scim.repository.ts";
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
    users: {
      findByEmail: vi.fn(async () => null),
      findById: vi.fn(async () => null),
      create: vi.fn(),
    } satisfies ScimUserProvisioning,
    governance: {
      departmentResolveByNameOrCreate: vi.fn(),
      departmentAssignUser: vi.fn(async () => undefined),
    },
    organization: new OrganizationAdministrationFake(),
    entitlements,
    lifecycle,
    provenOffboarding: false,
    tokenPepper: "scim-test-pepper",
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
        hashScheme: "hmac-sha256",
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
    const PEPPER = "scim-test-pepper";
    const TOKEN = "a".repeat(64);
    const hmacOf = (token: string, key = PEPPER) =>
      createHmac("sha256", key).update(token).digest("hex");
    const sha256Of = (token: string) => createHash("sha256").update(token).digest("hex");

    async function directoryHolding(...digests: { hashedToken: string; organizationId: string }[]) {
      const repository = MemoryScimRepository.create();
      for (const digest of digests) {
        await repository.createToken({
          ...digest,
          connectionId: "okta-primary",
          hashScheme: "hmac-sha256",
          description: null,
        });
      }
      return repository;
    }

    it("refuses an unknown value without asking anybody's plan", async () => {
      const findTokensByHashes = vi.fn(async () => []);
      const repository = scimRepositoryFixture({ findTokensByHashes });
      const entitlements = entitlementsOn("ENTERPRISE");

      const result = await service(
        repository,
        new RecordingScimSyncLifecycle(),
        entitlements,
      ).verifyToken({ token: "not-a-token" });

      expect(result).toEqual({ status: "invalid_token" });
      expect(entitlements.getActivePlan).not.toHaveBeenCalled();
      expect(findTokensByHashes).toHaveBeenCalledWith([
        hmacOf("not-a-token"),
        sha256Of("not-a-token"),
      ]);
    });

    /** @scenario "A token main minted under its keyed digest verifies" */
    it("verifies a token main stored as its keyed digest", async () => {
      const repository = await directoryHolding({
        hashedToken: hmacOf(TOKEN),
        organizationId: "org_1",
      });
      const entitlements = entitlementsOn("ENTERPRISE");

      const result = await service(
        repository,
        new RecordingScimSyncLifecycle(),
        entitlements,
      ).verifyToken({ token: TOKEN });

      expect(result).toMatchObject({ status: "ok", organizationId: "org_1" });
      expect(entitlements.getActivePlan).toHaveBeenCalledWith({ organizationId: "org_1" });
    });

    /** @scenario "A token minted before the keyed digest still verifies" */
    it("verifies a token stored as a bare digest", async () => {
      const repository = await directoryHolding({
        hashedToken: sha256Of(TOKEN),
        organizationId: "org_1",
      });

      const result = await service(
        repository,
        new RecordingScimSyncLifecycle(),
        entitlementsOn("ENTERPRISE"),
      ).verifyToken({ token: TOKEN });

      expect(result).toMatchObject({ status: "ok", organizationId: "org_1" });
    });

    it("does not verify a digest keyed on another deployment's secret", async () => {
      const repository = await directoryHolding({
        hashedToken: hmacOf(TOKEN, "another-deployment"),
        organizationId: "org_1",
      });

      const result = await service(
        repository,
        new RecordingScimSyncLifecycle(),
        entitlementsOn("ENTERPRISE"),
      ).verifyToken({ token: TOKEN });

      expect(result).toEqual({ status: "invalid_token" });
    });

    /** @scenario "A presented token that names two rows authenticates nobody" */
    it("refuses a token both of whose digests name a row", async () => {
      const repository = await directoryHolding(
        { hashedToken: hmacOf(TOKEN), organizationId: "org_1" },
        { hashedToken: sha256Of(TOKEN), organizationId: "org_2" },
      );
      const entitlements = entitlementsOn("ENTERPRISE");

      const result = await service(
        repository,
        new RecordingScimSyncLifecycle(),
        entitlements,
      ).verifyToken({ token: TOKEN });

      expect(result).toEqual({ status: "invalid_token" });
      expect(entitlements.getActivePlan).not.toHaveBeenCalled();
    });

    it("asks the plan about the organization the token names, not the caller's", async () => {
      const findTokensByHashes = vi.fn(async () => [
        { id: "token_1", organizationId: "org_1", connectionId: "okta-primary" },
      ]);
      const repository = scimRepositoryFixture({ findTokensByHashes });
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
    });
  });

  describe("when an administrator supplies the token value", () => {
    const PEPPER = "scim-test-pepper";

    async function directoryWithConnection() {
      const repository = MemoryScimRepository.create();
      repository.connections.push({ organizationId: "org_1", connectionId: "okta-primary" });
      return repository;
    }

    /** @scenario "An administrator may supply the token value, stored only as a keyed digest" */
    it("answers that value and stores only its keyed digest", async () => {
      const repository = await directoryWithConnection();
      const secret = "s".repeat(40);

      const minted = await service(
        repository,
        new RecordingScimSyncLifecycle(),
        entitlementsOn("ENTERPRISE"),
      ).generateToken({
        organizationId: "org_1",
        connectionId: "okta-primary",
        secret: ` ${secret} `,
      });

      expect(minted.token).toBe(secret);
      expect(repository.tokens.map((row) => row.hashedToken)).toEqual([
        createHmac("sha256", PEPPER).update(secret).digest("hex"),
      ]);
    });

    /** @scenario "A supplied token shorter than 32 characters is refused" */
    it("refuses a value shorter than a minted token", async () => {
      const repository = await directoryWithConnection();

      await expect(
        service(
          repository,
          new RecordingScimSyncLifecycle(),
          entitlementsOn("ENTERPRISE"),
        ).generateToken({
          organizationId: "org_1",
          connectionId: "okta-primary",
          secret: "s".repeat(31),
        }),
      ).rejects.toMatchObject({ code: "scim_token_too_short" });
      expect(repository.tokens).toEqual([]);
    });

    /** @scenario "A supplied token some existing token already hashes to is refused" */
    it("refuses a value a legacy token already hashes to", async () => {
      const repository = await directoryWithConnection();
      const secret = "s".repeat(40);
      await repository.createToken({
        organizationId: "org_2",
        connectionId: "elsewhere",
        hashedToken: createHash("sha256").update(secret).digest("hex"),
        hashScheme: "sha256",
        description: null,
      });

      await expect(
        service(
          repository,
          new RecordingScimSyncLifecycle(),
          entitlementsOn("ENTERPRISE"),
        ).generateToken({
          organizationId: "org_1",
          connectionId: "okta-primary",
          secret,
        }),
      ).rejects.toMatchObject({ code: "scim_token_unavailable" });
      expect(repository.tokens).toHaveLength(1);
    });
  });
});
