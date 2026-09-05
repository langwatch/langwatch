/**
 * System-managed API keys — the ephemeral Langy session key, one per chat session with a short
 * TTL — are minted and retired by the product.
 */
import { LANGY_SESSION_API_KEY_NAME } from "@langwatch/api-key-contract";
import { ApiKeyNotFoundError } from "@langwatch/api-key-contract";
import { describe, expect, it, vi } from "vitest";
import { ApiKeyGrantPolicyService } from "../api-key-grant-policy.service";
import { ApiKeyLifecycleService } from "../api-key-lifecycle.service";
import type { ApiKeyRepository, StoredApiKey } from "../../repositories/api-key.repository";

const ORG_ID = "org_1";
const USER_ID = "user_1";
const KEY_ID = "key_1";

function makeRepository(name: string): ApiKeyRepository {
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
    roleBindings: [],
    hashedSecret: "hashed",
  } as unknown as StoredApiKey;
  return {
    tryFindByIdInOrganization: vi.fn().mockResolvedValue(row),
    update: vi.fn().mockRejectedValue(new Error("must not be reached")),
    revoke: vi.fn().mockRejectedValue(new Error("must not be reached")),
  } as unknown as ApiKeyRepository;
}

function makeService(name: string) {
  const repository = makeRepository(name);
  const dependencies = {
    authz: {} as never,
    grants: { revokeBindingsWhere: vi.fn(), deleteRole: vi.fn() } as never,
    organizations: {} as never,
    projects: {} as never,
    bindingIds: {} as never,
    legacyGrants: {} as never,
    tokens: {} as never,
  };
  const policy = ApiKeyGrantPolicyService.create({ ...dependencies, repository });
  return ApiKeyLifecycleService.create({ ...dependencies, repository }, policy);
}

const caller = { callerUserId: USER_ID, callerIsAdmin: true, organizationId: ORG_ID };

describe("ApiKeyLifecycleService system-managed guard", () => {
  describe("given the ephemeral Langy session key", () => {
    /** @scenario "The ephemeral Langy session key cannot be renamed or revoked" */
    it("refuses a rename as not-found", async () => {
      const sut = makeService(LANGY_SESSION_API_KEY_NAME);
      await expect(
        sut.update({ id: KEY_ID, ...caller, name: "stolen" }),
      ).rejects.toBeInstanceOf(ApiKeyNotFoundError);
    });

    /** @scenario "The ephemeral Langy session key cannot be renamed or revoked" */
    it("refuses a revoke as not-found, so a live turn keeps working", async () => {
      const sut = makeService(LANGY_SESSION_API_KEY_NAME);
      await expect(sut.revoke({ id: KEY_ID, ...caller })).rejects.toBeInstanceOf(
        ApiKeyNotFoundError,
      );
    });
  });
});
