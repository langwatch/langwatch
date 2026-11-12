/**
 * Rotating a key through the application over memory stores: a new secret on the same key,
 * the old one refused at once, and the same caller rule as revoke.
 *
 * @see specs/api-keys/api-key-rotation.feature
 */
import { HIDDEN_SYSTEM_KEY_NAMES } from "@langwatch/api-key-contract";
import type { AuthzApi } from "@langwatch/authz-contract";
import type { OrganizationApi } from "@langwatch/organization-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import { SecretsChain, SecretsResolver } from "@langwatch/secrets";
import { MemorySharedCredentialStore } from "@langwatch/secrets/shared-credential";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { fromDate } from "@langwatch/time";
import { describe, expect, it, vi } from "vitest";

import { MemoryApiKeyAnswerCacheRepository } from "../../repositories/memory/memory.api-key-answer-cache.repository.ts";
import { MemoryApiKeyDatabase } from "../../repositories/memory/memory.api-key.database.ts";
import { MemoryApiKeyRepository } from "../../repositories/memory/memory.api-key.repository.ts";
import { ApiKeyTokenService } from "../../services/api-key-token.service.ts";
import { ApiKeyModule } from "../api-key.app.ts";

const ORG_ID = "acme";
const FOREIGN_ORG_ID = "globex";
const PEPPER = "pepper";
const ADA = { id: "ada" };
const MAX = { id: "max" };
const VIC = { id: "vic" };

type KeyOverrides = {
  name?: string;
  organizationId?: string;
  userId?: string | null;
  expiresAt?: Date | null;
  isSystemManaged?: boolean;
};

async function appOver() {
  const database = MemoryApiKeyDatabase.create();
  const apiKeys = MemoryApiKeyRepository.create({ memory: database });
  const tokens = ApiKeyTokenService.create(PEPPER);
  const resolver = SecretsResolver.over(
    SecretsChain.start({ environment: { API_KEY_PEPPER: PEPPER } }).withEnv(),
  );
  const app = await ApiKeyModule.create({
    repositories: {
      apiKeys,
      answers: MemoryApiKeyAnswerCacheRepository.create(),
      sandboxKeys: MemorySharedCredentialStore.create(),
      runKeys: MemorySharedCredentialStore.create(),
    },
    dependencies: {
      authorization: createApiFixture<AuthzApi>({
        hasPermission: vi.fn(async () => true),
        listUserBindings: vi.fn(async ({ userId }: { userId: string }) =>
          userId === ADA.id
            ? [
                {
                  id: "grant-ada",
                  role: "ADMIN",
                  scopeType: "ORGANIZATION",
                  scopeId: ORG_ID,
                  customRoleId: null,
                  expiresAt: null,
                },
              ]
            : [],
        ) as never,
        listApiKeyBindings: vi.fn(async () => []),
        revokeBindingsWhere: vi.fn(async () => 0),
      }),
      organizations: createApiFixture<OrganizationApi>({
        getMember: vi.fn(async ({ userId }: { userId: string }) => ({
          role: userId === ADA.id ? "ADMIN" : "MEMBER",
        })) as never,
      }),
      projects: createApiFixture<ProjectApi>({}),
    },
    secrets: resolver.scopeTo("api-key", Object.values(ApiKeyModule.secrets)),
  });

  const mintKey = async (overrides: KeyOverrides = {}) => {
    const generated = tokens.generate();
    const row = await apiKeys.create({
      name: overrides.name ?? "ci",
      description: "deploys",
      lookupId: generated.lookupId,
      hashedSecret: generated.hashedSecret,
      permissionMode: "all",
      userId: overrides.userId === undefined ? MAX.id : overrides.userId,
      createdByUserId: MAX.id,
      organizationId: overrides.organizationId ?? ORG_ID,
      expiresAt: overrides.expiresAt ? fromDate(overrides.expiresAt) : null,
      ingestSourceType: null,
      ingestionTemplateId: null,
      isSystemManaged: overrides.isSystemManaged ?? false,
      startsDisabled: false,
      grants: [],
    });
    return { id: row.id, token: generated.token };
  };
  const rowOf = (id: string) => database.keys().find((key) => key.id === id);

  return { app, mintKey, rowOf };
}

describe("given a live personal key owned by max", () => {
  describe("when max rotates it", () => {
    /** @scenario Rotating answers a new secret once and keeps the key's id */
    it("answers a new token for the same key, with its settings untouched", async () => {
      const { app, mintKey, rowOf } = await appOver();
      const { id, token } = await mintKey();
      const before = rowOf(id);

      const rotated = await app.rotateKey({ organizationId: ORG_ID, apiKeyId: id }, MAX);

      expect(rotated.token).toMatch(/^sk-lw-/);
      expect(rotated.token).not.toBe(token);
      expect(rotated.apiKey.id).toBe(id);
      const after = rowOf(id);
      expect(after).toMatchObject({
        id,
        name: before?.name,
        description: before?.description,
        permissionMode: before?.permissionMode,
        userId: before?.userId,
        createdAt: before?.createdAt,
        revokedAt: null,
      });
      expect(after?.lookupId).not.toBe(before?.lookupId);
      expect(after?.hashedSecret).not.toBe(before?.hashedSecret);
    });

    /** @scenario The old secret is refused at once and the new one is accepted */
    it("refuses the old token and accepts the new one as the same key", async () => {
      const { app, mintKey } = await appOver();
      const { id, token } = await mintKey();
      // Resolved once first, so the old secret's answer is held when the rotation lands.
      expect((await app.findVerifiedToken({ token }))?.id).toBe(id);

      const rotated = await app.rotateKey({ organizationId: ORG_ID, apiKeyId: id }, MAX);

      expect(await app.findVerifiedToken({ token })).toBeNull();
      expect((await app.findVerifiedToken({ token: rotated.token }))?.id).toBe(id);
    });
  });

  describe("when someone else rotates it", () => {
    /** @scenario Only the key's owner or an organization admin may rotate it */
    it("refuses a member who does not own it and leaves the secret as it was", async () => {
      const { app, mintKey, rowOf } = await appOver();
      const { id, token } = await mintKey();
      const before = rowOf(id);

      await expect(
        app.rotateKey({ organizationId: ORG_ID, apiKeyId: id }, VIC),
      ).rejects.toMatchObject({ code: "api_key_not_owned", httpStatus: 403 });
      expect(rowOf(id)?.hashedSecret).toBe(before?.hashedSecret);
      expect((await app.findVerifiedToken({ token }))?.id).toBe(id);
    });

    /** @scenario Only the key's owner or an organization admin may rotate it */
    it("lets an organization admin rotate it", async () => {
      const { app, mintKey } = await appOver();
      const { id } = await mintKey();

      const rotated = await app.rotateKey({ organizationId: ORG_ID, apiKeyId: id }, ADA);

      expect(rotated.apiKey.id).toBe(id);
    });

    /** @scenario An operator acting as a member cannot rotate a key */
    it("refuses an operator impersonating the owner, as a mint does", async () => {
      const { app, mintKey, rowOf } = await appOver();
      const { id } = await mintKey();
      const before = rowOf(id);

      await expect(
        app.rotateKey(
          { organizationId: ORG_ID, apiKeyId: id },
          { id: MAX.id, impersonatorId: "operator" },
        ),
      ).rejects.toMatchObject({ httpStatus: 403 });
      expect(rowOf(id)).toEqual(before);
    });
  });
});

describe("given a key that may not be rotated", () => {
  /** @scenario A revoked, expired, system or foreign key cannot be rotated */
  it("refuses a revoked key", async () => {
    const { app, mintKey, rowOf } = await appOver();
    const { id } = await mintKey();
    await app.revokeKey({ organizationId: ORG_ID, apiKeyId: id }, MAX);
    const before = rowOf(id);

    await expect(
      app.rotateKey({ organizationId: ORG_ID, apiKeyId: id }, MAX),
    ).rejects.toMatchObject({ code: "api_key_already_revoked" });
    expect(rowOf(id)).toEqual(before);
  });

  /** @scenario A revoked, expired, system or foreign key cannot be rotated */
  it("refuses an expired key, whose new secret would be dead", async () => {
    const { app, mintKey, rowOf } = await appOver();
    const { id } = await mintKey({ expiresAt: new Date(Date.now() - 60_000) });
    const before = rowOf(id);

    await expect(
      app.rotateKey({ organizationId: ORG_ID, apiKeyId: id }, MAX),
    ).rejects.toMatchObject({ code: "api_key_expired", httpStatus: 409 });
    expect(rowOf(id)).toEqual(before);
  });

  /** @scenario A revoked, expired, system or foreign key cannot be rotated */
  it("answers a key the platform minted for itself as not found", async () => {
    const { app, mintKey, rowOf } = await appOver();
    const { id } = await mintKey({ name: HIDDEN_SYSTEM_KEY_NAMES[0], isSystemManaged: true });
    const before = rowOf(id);

    await expect(
      app.rotateKey({ organizationId: ORG_ID, apiKeyId: id }, ADA),
    ).rejects.toMatchObject({ code: "api_key_not_found", httpStatus: 404 });
    expect(rowOf(id)).toEqual(before);
  });

  /** @scenario A revoked, expired, system or foreign key cannot be rotated */
  it("answers a key in another organization as not found", async () => {
    const { app, mintKey, rowOf } = await appOver();
    const { id } = await mintKey({ organizationId: FOREIGN_ORG_ID, userId: "globex-user" });
    const before = rowOf(id);

    await expect(
      app.rotateKey({ organizationId: ORG_ID, apiKeyId: id }, ADA),
    ).rejects.toMatchObject({ code: "api_key_not_found", httpStatus: 404 });
    expect(rowOf(id)).toEqual(before);
  });
});
