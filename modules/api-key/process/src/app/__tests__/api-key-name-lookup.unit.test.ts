import type { AuthzApi } from "@langwatch/authz-contract";
import type { OrganizationApi } from "@langwatch/organization-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import { SecretsChain, SecretsResolver } from "@langwatch/secrets";
/**
 * Naming a key by its id: the answer is the name and the revoked flag, only
 * to a member of the key's own organization, and nothing at all otherwise.
 *
 * @see specs/api-keys/unified-api-keys.feature
 */
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it, vi } from "vitest";

import type { ApiKeyCreateRecord } from "../../repositories/api-key.repository.ts";
import { MemoryApiKeyAnswerCacheRepository } from "../../repositories/memory/memory.api-key-answer-cache.repository.ts";
import { MemoryApiKeyDatabase } from "../../repositories/memory/memory.api-key.database.ts";
import { MemoryApiKeyRepository } from "../../repositories/memory/memory.api-key.repository.ts";
import { ApiKeyModule } from "../api-key.app.ts";

const ORG_ID = "organization-1";
const OTHER_ORG_ID = "organization-2";
const MEMBER = { id: "member-1" };

function record(overrides: Partial<ApiKeyCreateRecord> = {}): ApiKeyCreateRecord {
  return {
    name: "Deploy key",
    description: null,
    lookupId: `lookup_${Math.random().toString(36).slice(2)}`,
    hashedSecret: "hashed",
    permissionMode: "all",
    userId: MEMBER.id,
    createdByUserId: MEMBER.id,
    organizationId: ORG_ID,
    expiresAt: null,
    ingestSourceType: null,
    ingestionTemplateId: null,
    startsDisabled: false,
    grants: [],
    ...overrides,
  };
}

async function appOver({ member }: { member: boolean }) {
  const apiKeys = MemoryApiKeyRepository.create({ memory: MemoryApiKeyDatabase.create() });
  const findByIdInOrganization = vi.spyOn(apiKeys, "findByIdInOrganization");
  const resolver = SecretsResolver.over(
    SecretsChain.start({ environment: { API_KEY_PEPPER: "pepper" } }).withEnv(),
  );
  const app = await ApiKeyModule.create({
    repositories: { apiKeys, answers: MemoryApiKeyAnswerCacheRepository.create() },
    dependencies: {
      authorization: createApiFixture<AuthzApi>({ hasPermission: vi.fn(async () => member) }),
      organizations: createApiFixture<OrganizationApi>({}),
      projects: createApiFixture<ProjectApi>({}),
    },
    secrets: resolver.scopeTo("api-key", Object.values(ApiKeyModule.secrets)),
  });

  return { app, apiKeys, findByIdInOrganization };
}

describe("given an organization member looking a key up by its id", () => {
  describe("when the key belongs to their organization", () => {
    /** @scenario Any organization member can name a key they can already see */
    it("answers the key's name", async () => {
      const { app, apiKeys } = await appOver({ member: true });
      const { id } = await apiKeys.create(record({ name: "Claude Code on the laptop" }));

      await expect(
        app.findKeyName({ organizationId: ORG_ID, apiKeyId: id }, MEMBER),
      ).resolves.toEqual({ name: "Claude Code on the laptop", revoked: false });
    });

    /** @scenario A revoked key still resolves to its name */
    it("still answers a revoked key's name, marked as revoked", async () => {
      const { app, apiKeys } = await appOver({ member: true });
      const { id } = await apiKeys.create(record({ name: "Retired key" }));
      await apiKeys.revoke({ id, cause: "user" });

      await expect(
        app.findKeyName({ organizationId: ORG_ID, apiKeyId: id }, MEMBER),
      ).resolves.toEqual({ name: "Retired key", revoked: true });
    });
  });

  describe("when the id is unknown or belongs to another organization", () => {
    /** @scenario An unresolvable key id returns nothing rather than an error */
    it("answers nothing for both, so the two cases cannot be told apart", async () => {
      const { app, apiKeys } = await appOver({ member: true });
      const elsewhere = await apiKeys.create(record({ organizationId: OTHER_ORG_ID }));

      const unknown = await app.findKeyName(
        { organizationId: ORG_ID, apiKeyId: "ak_unknown" },
        MEMBER,
      );
      const foreign = await app.findKeyName(
        { organizationId: ORG_ID, apiKeyId: elsewhere.id },
        MEMBER,
      );

      expect(unknown).toBeNull();
      expect(foreign).toEqual(unknown);
    });
  });
});

describe("given someone outside the organization", () => {
  describe("when they look up a key id against that organization", () => {
    /** @scenario A non-member cannot name a key in an organization they are outside */
    it("is refused before any key is read", async () => {
      const { app, apiKeys, findByIdInOrganization } = await appOver({ member: false });
      const { id } = await apiKeys.create(record());

      await expect(
        app.findKeyName({ organizationId: ORG_ID, apiKeyId: id }, { id: "outsider-1" }),
      ).rejects.toMatchObject({ code: "api_key_scope_violation" });
      expect(findByIdInOrganization).not.toHaveBeenCalled();
    });
  });
});
