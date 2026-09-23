/**
 * Revoking a key retires the keys minted under it, from every entry
 * point: the API-keys page, REST, tRPC, and `langwatch logout`. A cascade
 * in only one caller left a live ingestion credential under a dead login.
 */
import { ApiKeyAlreadyRevokedError, isApiKeyRevocationCause } from "@langwatch/api-key-contract";
import { describe, expect, it, vi } from "vitest";

import type { ApiKeyRepository, StoredApiKey } from "../../repositories/api-key.repository.ts";
import { ApiKeyGrantPolicyService } from "../api-key-grant-policy.service.ts";
import { ApiKeyLifecycleService } from "../api-key-lifecycle.service.ts";

const ORG_ID = "org_1";
const USER_ID = "user_1";
const LOGIN_ID = "ak_login";

function keyRow(overrides: Partial<StoredApiKey> = {}): StoredApiKey {
  return {
    id: LOGIN_ID,
    name: "CLI login - laptop",
    description: null,
    organizationId: ORG_ID,
    userId: USER_ID,
    createdByUserId: USER_ID,
    createdByDeviceLabel: "laptop",
    parentApiKeyId: null,
    permissionMode: "restricted",
    revokedAt: null,
    revocationCause: null,
    lookupId: "lookup",
    lastUsedAt: null,
    ingestSourceType: null,
    ingestionTemplateId: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    hashedSecret: "hashed",
    roleBindings: [],
    ...overrides,
  } as unknown as StoredApiKey;
}

function makeService({ children }: { children: { id: string }[] }) {
  const rows = new Map<string, StoredApiKey>();
  rows.set(LOGIN_ID, keyRow());
  for (const child of children) {
    rows.set(child.id, keyRow({ id: child.id, parentApiKeyId: LOGIN_ID, name: "ingest key" }));
  }

  const findLiveChildren = vi.fn(async () => children);
  const revoke = vi.fn(async ({ id, cause }: { id: string; cause: string }) => {
    const row = rows.get(id)!;
    const revoked = { ...row, revokedAt: new Date(), revocationCause: cause };
    rows.set(id, revoked);
    return revoked;
  });
  const repository = {
    findByIdInOrganization: vi.fn(async ({ id }: { id: string }) => rows.get(id) ?? null),
    revoke,
    findLiveChildren,
  } as unknown as ApiKeyRepository;

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
  const service = ApiKeyLifecycleService.create({ ...dependencies, repository }, policy);

  return { service, repository, revoke, findLiveChildren };
}

const caller = { callerUserId: USER_ID, callerIsAdmin: false, organizationId: ORG_ID };

describe("ApiKeyLifecycleService.revoke", () => {
  describe("given a login key with ingestion keys minted under it", () => {
    /** @scenario "Revoking a login key retires its ingest keys" */
    /** @scenario "A re-login from the same device retires the keys of the session it replaces" */
    it("retires each child, recording that the session went rather than a decision about it", async () => {
      const { service, revoke } = makeService({
        children: [{ id: "ak_child_a" }, { id: "ak_child_b" }],
      });

      await service.revoke({ id: LOGIN_ID, ...caller });

      expect(revoke).toHaveBeenCalledWith(expect.objectContaining({ id: LOGIN_ID, cause: "user" }));
      // A person revoking the login did not make a decision about each key.
      expect(revoke).toHaveBeenCalledWith(
        expect.objectContaining({ id: "ak_child_a", cause: "session" }),
      );
      expect(revoke).toHaveBeenCalledWith(
        expect.objectContaining({ id: "ak_child_b", cause: "session" }),
      );
    });

    /** @scenario "A cause other than a person's own revoke passes through to the children unchanged" */
    it("passes a non-user cause straight through instead of remapping it", async () => {
      const { service, revoke } = makeService({ children: [{ id: "ak_child" }] });

      await service.revoke({ id: LOGIN_ID, ...caller, cause: "rotation" });

      expect(revoke).toHaveBeenCalledWith(
        expect.objectContaining({ id: "ak_child", cause: "rotation" }),
      );
    });

    /** @scenario "A cascade that fails does not fail the revoke that triggered it" */
    it("still reports the parent revoked when reading the children fails", async () => {
      const { service, findLiveChildren } = makeService({ children: [] });
      findLiveChildren.mockRejectedValue(new Error("postgres is down"));

      await expect(service.revoke({ id: LOGIN_ID, ...caller })).resolves.toMatchObject({
        id: LOGIN_ID,
      });
    });

    /** @scenario "A cascade does not recurse past one level" */
    it("does not recurse: a child's own revoke looks for no children", async () => {
      const { service, findLiveChildren } = makeService({ children: [{ id: "ak_child" }] });

      await service.revoke({ id: LOGIN_ID, ...caller });

      expect(findLiveChildren).toHaveBeenCalledTimes(1);
    });

    it("tolerates a child already revoked by an earlier attempt", async () => {
      const { service, revoke } = makeService({ children: [{ id: "ak_child" }] });
      revoke.mockImplementation(async ({ id, cause }: { id: string; cause: string }) => {
        if (id === "ak_child") throw new ApiKeyAlreadyRevokedError(id);
        if (!isApiKeyRevocationCause(cause)) throw new Error(`Unexpected cause: ${cause}`);
        return {
          ...keyRow({ id }),
          revokedAt: new Date(),
          revocationCause: cause,
        };
      });

      await expect(service.revoke({ id: LOGIN_ID, ...caller })).resolves.toMatchObject({
        id: LOGIN_ID,
      });
    });
  });

  describe("given a key nothing was minted under", () => {
    it("revokes it and nothing else", async () => {
      const { service, revoke } = makeService({ children: [] });

      await service.revoke({ id: LOGIN_ID, ...caller });

      expect(revoke).toHaveBeenCalledTimes(1);
    });
  });
});
