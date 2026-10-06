import type { AuthzApi } from "@langwatch/authz-contract";
import type { OrganizationApi } from "@langwatch/organization-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import { SecretsChain, SecretsResolver } from "@langwatch/secrets";
/**
 * A key id from another organization answers as an unknown id on every
 * addressed operation, and the key stays as it was.
 *
 * @see specs/api-keys/api-keys-v2.feature
 */
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it, vi } from "vitest";

import { MemoryApiKeyAnswerCacheRepository } from "../../repositories/memory/memory.api-key-answer-cache.repository.ts";
import { MemoryApiKeyDatabase } from "../../repositories/memory/memory.api-key.database.ts";
import { MemoryApiKeyRepository } from "../../repositories/memory/memory.api-key.repository.ts";
import { ApiKeyModule } from "../api-key.app.ts";

const ORG_ID = "acme";
const FOREIGN_ORG_ID = "globex";
const ADA = { id: "ada" };

async function appOver() {
  const database = MemoryApiKeyDatabase.create();
  const apiKeys = MemoryApiKeyRepository.create({ memory: database });
  const resolver = SecretsResolver.over(
    SecretsChain.start({ environment: { API_KEY_PEPPER: "pepper" } }).withEnv(),
  );
  const app = await ApiKeyModule.create({
    repositories: { apiKeys, answers: MemoryApiKeyAnswerCacheRepository.create() },
    dependencies: {
      authorization: createApiFixture<AuthzApi>({
        hasPermission: vi.fn(async () => true),
        listUserBindings: vi.fn(async () => [
          {
            id: "grant-ada",
            role: "ADMIN",
            scopeType: "ORGANIZATION",
            scopeId: ORG_ID,
            customRoleId: null,
            expiresAt: null,
          },
        ]) as never,
        listApiKeyBindings: vi.fn(async () => []),
        revokeBindingsWhere: vi.fn(async () => 0),
      }),
      organizations: createApiFixture<OrganizationApi>({
        getMember: vi.fn(async () => ({ role: "ADMIN" })) as never,
      }),
      projects: createApiFixture<ProjectApi>({}),
    },
    secrets: resolver.scopeTo("api-key", Object.values(ApiKeyModule.secrets)),
  });
  const foreign = await apiKeys.create({
    name: "Globex key",
    description: null,
    lookupId: "lookup_globex",
    hashedSecret: "hashed",
    permissionMode: "all",
    userId: "globex-user",
    createdByUserId: "globex-user",
    organizationId: FOREIGN_ORG_ID,
    expiresAt: null,
    ingestSourceType: null,
    ingestionTemplateId: null,
    startsDisabled: false,
    grants: [],
  });
  const foreignRow = () => database.keys().find((key) => key.id === foreign.id);

  return { app, foreignId: foreign.id, foreignRow };
}

const NOT_FOUND = { code: "api_key_not_found", httpStatus: 404 };

describe("given a key minted in another organization", () => {
  describe("when an organization admin addresses it by id", () => {
    /** @scenario A key id from another organization answers 404 */
    it("answers a read as not found", async () => {
      const { app, foreignId } = await appOver();

      await expect(
        app.getByIdForCaller({
          id: foreignId,
          organizationId: ORG_ID,
          callerUserId: ADA.id,
          callerCanReadAnyKey: true,
        }),
      ).rejects.toMatchObject(NOT_FOUND);
    });

    /** @scenario A key id from another organization answers 404 */
    it("answers an edit as not found and leaves the key unchanged", async () => {
      const { app, foreignId, foreignRow } = await appOver();
      const before = foreignRow();

      await expect(
        app.update({
          id: foreignId,
          callerUserId: ADA.id,
          callerIsAdmin: true,
          organizationId: ORG_ID,
          name: "renamed",
        }),
      ).rejects.toMatchObject(NOT_FOUND);
      expect(foreignRow()).toEqual(before);
    });

    /** @scenario A key id from another organization answers 404 */
    it("answers a delete as not found and leaves the key live", async () => {
      const { app, foreignId, foreignRow } = await appOver();

      await expect(
        app.revoke({
          id: foreignId,
          callerUserId: ADA.id,
          callerIsAdmin: true,
          organizationId: ORG_ID,
        }),
      ).rejects.toMatchObject(NOT_FOUND);
      expect(foreignRow()?.revokedAt).toBeNull();
    });

    /** @scenario A key id from another organization answers 404 */
    it("answers the apiKey.revoke mutation as not found and leaves the key live", async () => {
      const { app, foreignId, foreignRow } = await appOver();

      await expect(
        app.revokeKey({ organizationId: ORG_ID, apiKeyId: foreignId }, ADA),
      ).rejects.toMatchObject(NOT_FOUND);
      expect(foreignRow()?.revokedAt).toBeNull();
    });
  });
});
