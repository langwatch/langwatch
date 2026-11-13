/**
 * Staff access keys (ADR-202): ownerless, system-managed, restricted to the staff bags at
 * organization scope, hidden from listings, under names a customer may not take.
 * @vitest-environment node
 * @see modules/staff-access/specs/staff-access-use.feature
 */
import { randomUUID } from "node:crypto";

import {
  STAFF_READ_KEY_NAME,
  STAFF_SUPPORT_KEY_NAME,
  type ResolvedApiKeyCredential,
} from "@langwatch/api-key-contract";
import {
  STAFF_READER_CONTENT_PERMISSIONS,
  STAFF_READER_METADATA_PERMISSIONS,
  STAFF_SUPPORT_WRITE_PERMISSIONS,
  type AuthzAccessBinding,
  type AuthzApi,
} from "@langwatch/authz-contract";
import { createLogger } from "@langwatch/observability";
import type { OrganizationApi } from "@langwatch/organization-contract";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaTenancyGuardService,
} from "@langwatch/prisma-client";
import type { ProjectApi } from "@langwatch/project-contract";
import { SecretsChain, SecretsResolver } from "@langwatch/secrets";
import { MemorySharedCredentialStore } from "@langwatch/secrets/shared-credential";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

import { MemoryApiKeyAnswerCacheRepository } from "../../repositories/memory/memory.api-key-answer-cache.repository.ts";
import { MemorySigningKeyUsageRepository } from "../../repositories/memory/memory.signing-key-usage.repository.ts";
import { MemorySigningKeyRepository } from "../../repositories/memory/memory.signing-key.repository.ts";
import { PrismaApiKeyRepository } from "../../repositories/prisma/prisma.api-key.repository.ts";
import { ApiKeyModule } from "../api-key.app.ts";

const DB_URL = process.env.LANGWATCH_TEST_DATABASE_URL;
const HOUR_MS = 60 * 60 * 1000;

describe.skipIf(!DB_URL)("staff access keys on Postgres", () => {
  const ns = `staff-key-${randomUUID().slice(0, 8)}`;
  const connection = PrismaConnectionService.create({
    guard: PrismaTenancyGuardService.create(),
    logger: createLogger("langwatch:api-key:test:staff-access-key"),
  }).connect(PrismaConfigService.create().resolve({ databaseUrl: DB_URL ?? "", log: ["error"] }));
  const prisma = connection.client;
  let organizationId: string;
  let projectId: string;
  let app: ApiKeyModule;
  const attachBindings = vi.fn<AuthzApi["attachBindings"]>(async ({ bindings }) => ({
    attached: bindings.map((binding) => binding.bindingId),
    duplicates: [],
  }));
  const defineRole = vi.fn<AuthzApi["defineRole"]>(async () => {});

  beforeAll(async () => {
    const organization = await prisma.organization.create({
      data: { name: "ACME", slug: `--${ns}` },
    });
    organizationId = organization.id;
    const team = await prisma.team.create({
      data: { name: "ACME team", slug: `--${ns}-team`, organizationId },
    });
    const project = await prisma.project.create({
      data: {
        name: "ACME agent",
        slug: `--${ns}-project`,
        teamId: team.id,
        apiKey: `legacy-${randomUUID()}`,
        language: "python",
        framework: "openai",
      },
    });
    projectId = project.id;

    const authorization = createApiFixture<AuthzApi>({
      getScope: async ({ projectId: id }: { projectId?: string }) => ({
        type: "project",
        id: id ?? projectId,
        teamId: team.id,
        organizationId,
      }),
      defineRole,
      attachBindings,
      listApiKeyBindings: async ({ apiKeyIds }) =>
        apiKeyIds.map((apiKeyId): AuthzAccessBinding => ({
          id: `grant-${apiKeyId}`,
          organizationId,
          userId: null,
          groupId: null,
          apiKeyId,
          role: "CUSTOM",
          customRoleId: null,
          scopeType: "ORGANIZATION",
          scopeId: organizationId,
          createdAt: new Date(0),
          user: null,
          group: null,
          apiKey: null,
          customRole: null,
        })),
      revokeBindingsWhere: async () => 0,
      findPermissionsBeyondCaller: async () => [],
      listUserBindings: async () => [],
      hasPermission: async () => true,
    });
    const resolver = SecretsResolver.over(
      SecretsChain.start({ environment: { API_KEY_PEPPER: "pepper" } }).withEnv(),
    );
    app = await ApiKeyModule.create({
      repositories: {
        apiKeys: PrismaApiKeyRepository.create({ prisma }),
        answers: MemoryApiKeyAnswerCacheRepository.create(),
        sandboxKeys: MemorySharedCredentialStore.create(),
        runKeys: MemorySharedCredentialStore.create(),
        signingKeys: MemorySigningKeyRepository.create(),
        signingKeyUsage: MemorySigningKeyUsageRepository.create(),
      },
      dependencies: {
        authorization,
        organizations: createApiFixture<OrganizationApi>({ isMember: async () => true }),
        projects: createApiFixture<ProjectApi>({
          findPersonalWorkspaceOwner: async () => null,
          findIdentity: async (id: string) =>
            id === project.id
              ? {
                  id,
                  name: project.name,
                  slug: project.slug,
                  teamId: team.id,
                  organizationId,
                  isPersonal: false,
                  ownerUserId: null,
                  kind: "application",
                }
              : null,
        }),
      },
      secrets: resolver.scopeTo("api-key", Object.values(ApiKeyModule.secrets)),
      config: { docsOrigins: void 0, isSaas: true, publicBaseUrl: "https://app.langwatch.ai" },
    });
  });

  afterAll(async () => {
    await prisma.apiKey.deleteMany({ where: { organizationId } });
    await prisma.project.deleteMany({ where: { id: projectId } });
    await prisma.team.deleteMany({ where: { organizationId } });
    await prisma.organization.delete({ where: { id: organizationId } });
    await prisma.$disconnect();
  });

  const inAnHour = () => new Date(Date.now() + HOUR_MS);
  const readBag = [...STAFF_READER_METADATA_PERMISSIONS, ...STAFF_READER_CONTENT_PERMISSIONS];
  const supportBag = [...STAFF_READER_METADATA_PERMISSIONS, ...STAFF_SUPPORT_WRITE_PERMISSIONS];

  describe("when a support key is minted", () => {
    it("is ownerless, system-managed, restricted at organization scope and hidden", async () => {
      attachBindings.mockClear();
      const minted = await app.mintStaffAccessKey({
        organizationId,
        permissions: supportBag,
        expiresAt: inAnHour(),
        kind: "support",
      });

      const row = await prisma.apiKey.findUniqueOrThrow({ where: { id: minted.apiKeyId } });
      expect(row).toMatchObject({
        name: STAFF_SUPPORT_KEY_NAME,
        userId: null,
        createdByUserId: null,
        isSystemManaged: true,
        permissionMode: "restricted",
        organizationId,
        revokedAt: null,
      });
      expect(row.expiresAt!.getTime()).toBeLessThanOrEqual(Date.now() + HOUR_MS);
      const attached = attachBindings.mock.calls.flatMap(([input]) => input.bindings);
      expect(attached.map(({ scopeType, scopeId }) => [scopeType, scopeId])).toEqual([
        ["ORGANIZATION", organizationId],
      ]);
      expect(await app.listAll({ organizationId })).toEqual([]);
    });

    it("resolves as a staff access key at the project door and the organization door", async () => {
      const minted = await app.mintStaffAccessKey({
        organizationId,
        permissions: readBag,
        expiresAt: inAnHour(),
        kind: "read",
      });

      const resolved = (await app.findResolvedToken({
        token: minted.token,
        projectId,
      })) as Extract<ResolvedApiKeyCredential, { type: "apiKey" }> | null;
      expect(resolved).toMatchObject({ type: "apiKey", userId: null, isStaffAccessKey: true });
      expect(resolved?.isUnattendedRunKey).toBe(false);
      const organization = await app.resolveOrganizationToken({ token: minted.token });
      expect(organization).toMatchObject({ ok: true, resolved: { isStaffAccessKey: true } });
      const row = await prisma.apiKey.findUniqueOrThrow({ where: { id: minted.apiKeyId } });
      expect(row.name).toBe(STAFF_READ_KEY_NAME);
    });
  });

  describe("when the mint asks more than the staff bag", () => {
    it("refuses a permission outside the bag of its kind", async () => {
      await expect(
        app.mintStaffAccessKey({
          organizationId,
          permissions: ["traces:view", "evaluations:create"],
          expiresAt: inAnHour(),
          kind: "read",
        }),
      ).rejects.toMatchObject({ code: "api_key_scope_violation" });
      await expect(
        app.mintStaffAccessKey({
          organizationId,
          permissions: ["secrets:view"],
          expiresAt: inAnHour(),
          kind: "support",
        }),
      ).rejects.toMatchObject({ code: "api_key_scope_violation" });
    });

    it("refuses a key that would outlive the hour or is already expired", async () => {
      for (const expiresAt of [new Date(Date.now() + 2 * HOUR_MS), new Date(Date.now() - 1)]) {
        await expect(
          app.mintStaffAccessKey({ organizationId, permissions: readBag, expiresAt, kind: "read" }),
        ).rejects.toMatchObject({ code: "api_key_scope_violation" });
      }
    });
  });

  describe("when a customer names a key like a staff key", () => {
    it("refuses the reserved name", async () => {
      for (const name of [STAFF_SUPPORT_KEY_NAME, STAFF_READ_KEY_NAME]) {
        await expect(
          app.create({
            name,
            userId: null,
            createdByUserId: null,
            organizationId,
            bindings: [{ role: "ADMIN", scopeType: "ORGANIZATION", scopeId: organizationId }],
          }),
        ).rejects.toMatchObject({ code: "api_key_reserved_name" });
      }
    });
  });

  describe("when a staff key is revoked", () => {
    it("stops resolving, and a second revoke is silent", async () => {
      const minted = await app.mintStaffAccessKey({
        organizationId,
        permissions: readBag,
        expiresAt: inAnHour(),
        kind: "read",
      });
      expect(await app.findVerifiedToken({ token: minted.token })).not.toBeNull();

      await app.revokeStaffAccessKey({ apiKeyId: minted.apiKeyId });
      await app.revokeStaffAccessKey({ apiKeyId: minted.apiKeyId });

      expect(await app.findVerifiedToken({ token: minted.token })).toBeNull();
      const row = await prisma.apiKey.findUniqueOrThrow({ where: { id: minted.apiKeyId } });
      expect(row.revokedAt).not.toBeNull();
    });

    it("leaves any other key alone", async () => {
      const customer = await app.create({
        name: `customer-${ns}`,
        userId: null,
        createdByUserId: null,
        organizationId,
        bindings: [{ role: "ADMIN", scopeType: "ORGANIZATION", scopeId: organizationId }],
      });

      await app.revokeStaffAccessKey({ apiKeyId: customer.apiKey.id });

      expect(await app.findVerifiedToken({ token: customer.token })).not.toBeNull();
    });
  });
});
