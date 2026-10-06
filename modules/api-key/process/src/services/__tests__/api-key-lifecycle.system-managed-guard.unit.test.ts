/**
 * System-managed API keys — the ephemeral Langy session key, one per chat session with a short
 * TTL — are minted and retired by the product.
 */
import {
  LANGY_SESSION_API_KEY_NAME,
  WORKFLOW_RUN_API_KEY_NAME,
  ApiKeyNotFoundError,
} from "@langwatch/api-key-contract";
import { describe, expect, it, vi } from "vitest";

import type { ApiKeyRepository, StoredApiKey } from "../../repositories/api-key.repository.ts";
import { MemoryApiKeyDatabase } from "../../repositories/memory/memory.api-key.database.ts";
import { MemoryApiKeyRepository } from "../../repositories/memory/memory.api-key.repository.ts";
import { ApiKeyGrantPolicyService } from "../api-key-grant-policy.service.ts";
import { ApiKeyLifecycleService } from "../api-key-lifecycle.service.ts";

const ORG_ID = "org_1";
const USER_ID = "user_1";
const KEY_ID = "key_1";

function makeRepository(name: string, isSystemManaged = false): ApiKeyRepository {
  const row: StoredApiKey = {
    id: KEY_ID,
    name,
    description: null,
    organizationId: ORG_ID,
    userId: USER_ID,
    createdByUserId: USER_ID,
    createdByDeviceLabel: null,
    permissionMode: "all",
    revokedAt: null,
    parentApiKeyId: null,
    lookupId: "lookup",
    expiresAt: null,
    revocationCause: null,
    lastUsedAt: null,
    ingestSourceType: null,
    ingestionTemplateId: null,
    isSystemManaged,
    createdAt: new Date("2026-01-01T00:00:00Z"),
    updatedAt: new Date("2026-01-01T00:00:00Z"),
    grants: [],
    hashedSecret: "hashed",
  };
  return Object.assign(MemoryApiKeyRepository.create({ memory: MemoryApiKeyDatabase.create() }), {
    findByIdInOrganization: vi
      .fn<ApiKeyRepository["findByIdInOrganization"]>()
      .mockResolvedValue(row),
    update: vi.fn<ApiKeyRepository["update"]>().mockResolvedValue(row),
    revoke: vi
      .fn<ApiKeyRepository["revoke"]>()
      .mockResolvedValue({ ...row, revokedAt: new Date() }),
  });
}

function makeService(name: string, isSystemManaged = false) {
  const repository = makeRepository(name, isSystemManaged);
  const dependencies = {
    authz: { listApiKeyBindings: async () => [] } as never,
    grants: { revokeBindingsWhere: vi.fn(), deleteRole: vi.fn() } as never,
    organizations: {} as never,
    projects: {} as never,
    bindingIds: {} as never,
    legacyGrants: {} as never,
    tokens: {} as never,
  };
  const policy = ApiKeyGrantPolicyService.create(dependencies);
  return ApiKeyLifecycleService.create({ ...dependencies, repository }, policy, {
    forget: async () => void 0,
  });
}

const caller = { callerUserId: USER_ID, callerIsAdmin: true, organizationId: ORG_ID };

describe("ApiKeyLifecycleService system-managed guard", () => {
  describe("given the ephemeral Langy session key", () => {
    /** @scenario "The ephemeral Langy session key cannot be renamed or revoked" */
    it("refuses a rename as not-found", async () => {
      const sut = makeService(LANGY_SESSION_API_KEY_NAME);
      await expect(sut.update({ id: KEY_ID, ...caller, name: "stolen" })).rejects.toBeInstanceOf(
        ApiKeyNotFoundError,
      );
    });

    /** @scenario "The ephemeral Langy session key cannot be renamed or revoked" */
    it("refuses a revoke as not-found, so a live turn keeps working", async () => {
      const sut = makeService(LANGY_SESSION_API_KEY_NAME);
      await expect(sut.revoke({ id: KEY_ID, ...caller })).rejects.toBeInstanceOf(
        ApiKeyNotFoundError,
      );
    });
  });

  describe("given a run key the system minted", () => {
    /** @scenario "A customer key named like a system key stays visible and manageable" */
    it("refuses a rename and a revoke as not-found", async () => {
      const sut = makeService(WORKFLOW_RUN_API_KEY_NAME, true);
      await expect(sut.update({ id: KEY_ID, ...caller, name: "mine" })).rejects.toBeInstanceOf(
        ApiKeyNotFoundError,
      );
      await expect(sut.revoke({ id: KEY_ID, ...caller })).rejects.toBeInstanceOf(
        ApiKeyNotFoundError,
      );
    });
  });

  describe("given a customer key that already carries a newly reserved name", () => {
    /** @scenario "A customer key named like a system key stays visible and manageable" */
    it("lets its owner edit it and revoke it", async () => {
      const sut = makeService(WORKFLOW_RUN_API_KEY_NAME);
      await expect(
        sut.update({ id: KEY_ID, ...caller, description: "still mine" }),
      ).resolves.toMatchObject({ name: WORKFLOW_RUN_API_KEY_NAME });
      await expect(sut.revoke({ id: KEY_ID, ...caller })).resolves.toMatchObject({
        id: KEY_ID,
      });
    });

    it("refuses moving another key into that name", async () => {
      const sut = makeService("Nightly export");
      await expect(
        sut.update({ id: KEY_ID, ...caller, name: WORKFLOW_RUN_API_KEY_NAME }),
      ).rejects.toBeInstanceOf(ApiKeyNotFoundError);
    });
  });
});
