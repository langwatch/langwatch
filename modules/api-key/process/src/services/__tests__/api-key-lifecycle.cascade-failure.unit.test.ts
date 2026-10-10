import type * as observabilityModule from "@langwatch/observability";
/**
 * A login key revoke succeeds when the keys minted under it cannot be
 * retired: the failure is logged, not thrown.
 * @see specs/ai-gateway/governance/ingest-api-key-lifecycle.feature
 */
import { describe, expect, it, vi } from "vitest";

import type { ApiKeyRepository, StoredApiKey } from "../../repositories/api-key.repository.ts";
import { MemoryApiKeyDatabase } from "../../repositories/memory/memory.api-key.database.ts";
import { MemoryApiKeyRepository } from "../../repositories/memory/memory.api-key.repository.ts";
import { ApiKeyGrantPolicyService } from "../api-key-grant-policy.service.ts";
import { ApiKeyLifecycleService } from "../api-key-lifecycle.service.ts";

const logged = vi.hoisted(() => ({
  error: vi.fn(),
  warn: vi.fn(),
  info: vi.fn(),
  debug: vi.fn(),
}));

vi.mock("@langwatch/observability", async (importOriginal) => ({
  ...(await importOriginal<typeof observabilityModule>()),
  createLogger: () => logged,
}));

const ORG_ID = "org_1";
const USER_ID = "user_1";
const LOGIN_ID = "ak_login";
const INGEST_ID = "ak_ingest";

function keyRow(overrides: Partial<StoredApiKey>): StoredApiKey {
  return {
    id: LOGIN_ID,
    name: "key",
    description: null,
    organizationId: ORG_ID,
    userId: USER_ID,
    createdByUserId: USER_ID,
    createdByDeviceLabel: "laptop",
    parentApiKeyId: null,
    permissionMode: "restricted",
    expiresAt: null,
    revokedAt: null,
    revocationCause: null,
    lookupId: "lookup",
    lastUsedAt: null,
    ingestSourceType: null,
    ingestionTemplateId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    hashedSecret: "hashed",
    grants: [],
    ...overrides,
  };
}

function makeService() {
  const rows = new Map<string, StoredApiKey>([
    [LOGIN_ID, keyRow({})],
    [INGEST_ID, keyRow({ id: INGEST_ID, parentApiKeyId: LOGIN_ID, lookupId: "lookup_ingest" })],
  ]);
  const revoke = vi.fn<ApiKeyRepository["revoke"]>(async ({ id, cause }) => {
    if (id === INGEST_ID) throw new Error("postgres refused the ingest key revoke");
    const revoked = { ...rows.get(id)!, revokedAt: new Date(), revocationCause: cause };
    rows.set(id, revoked);
    return revoked;
  });
  const repository = Object.assign(
    MemoryApiKeyRepository.create({ memory: MemoryApiKeyDatabase.create() }),
    {
      findByIdInOrganization: vi.fn<ApiKeyRepository["findByIdInOrganization"]>(
        async ({ id }) => rows.get(id) ?? null,
      ),
      findLiveChildren: vi.fn<ApiKeyRepository["findLiveChildren"]>(async () => [
        { id: INGEST_ID },
      ]),
      revoke,
    },
  );
  const dependencies = {
    authz: { listApiKeyBindings: async () => [] } as never,
    grants: { revokeBindingsWhere: vi.fn(async () => void 0), deleteRole: vi.fn() } as never,
    organizations: {} as never,
    projects: {} as never,
    bindingIds: {} as never,
    legacyGrants: {} as never,
    tokens: {} as never,
  };
  const policy = ApiKeyGrantPolicyService.create(dependencies);
  const service = ApiKeyLifecycleService.create({ ...dependencies, repository }, policy, {
    forget: vi.fn(async () => void 0),
  });

  return { service, rows };
}

describe("given a login key whose ingest keys cannot be revoked", () => {
  describe("when the login key is revoked", () => {
    /** @scenario "A cascade that fails does not fail the logout" */
    it("still revokes the login key, answers no failure and logs the one that happened", async () => {
      const { service, rows } = makeService();

      const revoked = await service.revoke({
        id: LOGIN_ID,
        callerUserId: USER_ID,
        callerIsAdmin: false,
        organizationId: ORG_ID,
      });

      expect(revoked.id).toBe(LOGIN_ID);
      expect(rows.get(LOGIN_ID)).toMatchObject({ revocationCause: "user" });
      expect(rows.get(LOGIN_ID)?.revokedAt).not.toBeNull();
      expect(logged.warn).toHaveBeenCalledWith(
        expect.objectContaining({ apiKeyId: INGEST_ID, parentApiKeyId: LOGIN_ID }),
        expect.any(String),
      );
    });
  });
});
