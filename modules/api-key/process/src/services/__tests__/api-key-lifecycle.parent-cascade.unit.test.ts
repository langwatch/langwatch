/**
 * Revoking a key retires the keys minted under it, from every entry
 * point: the API-keys page, REST, tRPC, and `langwatch logout`. A cascade
 * in only one caller left a live ingestion credential under a dead login.
 */
import { ApiKeyAlreadyRevokedError, isApiKeyRevocationCause } from "@langwatch/api-key-contract";
import { describe, expect, it, vi } from "vitest";

import type { ApiKeyRepository, StoredApiKey } from "../../repositories/api-key.repository.ts";
import { MemoryApiKeyDatabase } from "../../repositories/memory/memory.api-key.database.ts";
import { MemoryApiKeyRepository } from "../../repositories/memory/memory.api-key.repository.ts";
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

function makeService({
  children,
  grantsFail = false,
  customRoleId = null,
}: {
  children: { id: string }[];
  grantsFail?: boolean;
  customRoleId?: string | null;
}) {
  const rows = new Map<string, StoredApiKey>();
  rows.set(LOGIN_ID, keyRow());
  for (const child of children) {
    rows.set(child.id, keyRow({ id: child.id, parentApiKeyId: LOGIN_ID, name: "ingest key" }));
  }

  const findLiveChildren = vi.fn<ApiKeyRepository["findLiveChildren"]>(async () => children);
  const revoke = vi.fn<ApiKeyRepository["revoke"]>(async ({ id, cause }) => {
    const row = rows.get(id)!;
    const revoked = { ...row, revokedAt: new Date(), revocationCause: cause };
    rows.set(id, revoked);
    return revoked;
  });
  const repository = Object.assign(
    MemoryApiKeyRepository.create({ memory: MemoryApiKeyDatabase.create() }),
    {
      findByIdInOrganization: vi.fn<ApiKeyRepository["findByIdInOrganization"]>(
        async ({ id }) => rows.get(id) ?? null,
      ),
      revoke,
      findLiveChildren,
    },
  );

  const revokeBindingsWhere = vi.fn(async () => {
    if (grantsFail) throw new Error("ledger unavailable");
  });
  const forget = vi.fn(async () => void 0);
  const deleteRole = vi.fn(async () => void 0);
  const listApiKeyBindings = async () =>
    customRoleId
      ? [
          {
            id: "rb_1",
            apiKeyId: LOGIN_ID,
            role: "CUSTOM",
            customRoleId,
            scopeType: "ORGANIZATION",
            scopeId: ORG_ID,
          },
        ]
      : [];
  const dependencies = {
    authz: { listApiKeyBindings } as never,
    grants: { revokeBindingsWhere, deleteRole } as never,
    organizations: {} as never,
    projects: {} as never,
    bindingIds: {} as never,
    legacyGrants: {} as never,
    tokens: {} as never,
  };
  const policy = ApiKeyGrantPolicyService.create(dependencies);
  const service = ApiKeyLifecycleService.create({ ...dependencies, repository }, policy, {
    forget,
  });

  return { service, repository, revoke, findLiveChildren, revokeBindingsWhere, forget, deleteRole };
}

const caller = { callerUserId: USER_ID, callerIsAdmin: false, organizationId: ORG_ID };

describe("ApiKeyLifecycleService.revoke", () => {
  describe("given a login key with ingestion keys minted under it", () => {
    /** @scenario "Revoking a login key retires its ingest keys" */
    /** @scenario "A re-login from the same device retires the keys of the session it replaces" */
    /** @scenario Revoking a login key from the API keys page retires its ingest keys */
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
    /** @scenario A re-login names rotation as the cause of the login key it replaces */
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

describe("ApiKeyLifecycleService.revokeChildren", () => {
  describe("given a revoked login key with two ingest keys under it", () => {
    it("retires both and answers the count main's session revoke reported", async () => {
      const { service, revoke } = makeService({
        children: [{ id: "ak_child_1" }, { id: "ak_child_2" }],
      });

      await expect(
        service.revokeChildren({
          parentApiKeyId: LOGIN_ID,
          organizationId: ORG_ID,
          callerUserId: USER_ID,
          cause: "user",
        }),
      ).resolves.toBe(2);
      expect(revoke.mock.calls.map(([input]) => input.cause)).toEqual(["session", "session"]);
    });

    it("does not count a child an earlier attempt already revoked", async () => {
      const { service, revoke } = makeService({
        children: [{ id: "ak_child_1" }, { id: "ak_gone" }],
      });
      const revokeRow = revoke.getMockImplementation();
      revoke.mockImplementation(async (input) => {
        if (input.id === "ak_gone") throw new ApiKeyAlreadyRevokedError(input.id);
        return revokeRow!(input);
      });

      await expect(
        service.revokeChildren({
          parentApiKeyId: LOGIN_ID,
          organizationId: ORG_ID,
          callerUserId: USER_ID,
          cause: "user",
        }),
      ).resolves.toBe(1);
    });
  });
});

describe("ApiKeyLifecycleService.revoke ordering", () => {
  /** @scenario A revoked key is refused before its grants are retracted */
  it("marks the key revoked and refuses its shared answer before removing its grants", async () => {
    const { service, revoke, forget, revokeBindingsWhere } = makeService({ children: [] });

    await service.revoke({ id: LOGIN_ID, ...caller, cascadeToChildren: false });

    const [revokedAt] = revoke.mock.invocationCallOrder;
    const [forgottenAt] = forget.mock.invocationCallOrder;
    const [retractedAt] = revokeBindingsWhere.mock.invocationCallOrder;
    expect(revokedAt).toBeLessThan(forgottenAt!);
    expect(forgottenAt).toBeLessThan(retractedAt!);
  });

  it("leaves the key refused when its grants cannot be removed", async () => {
    const { service, revoke, forget } = makeService({ children: [], grantsFail: true });

    await expect(
      service.revoke({ id: LOGIN_ID, ...caller, cascadeToChildren: false }),
    ).rejects.toThrow("ledger unavailable");

    expect(revoke).toHaveBeenCalledWith(expect.objectContaining({ id: LOGIN_ID }));
    expect(forget).toHaveBeenCalledWith(expect.objectContaining({ revoked: true }));
  });
});

describe("ApiKeyLifecycleService.revoke without the projection hold", () => {
  /** @scenario "Rotating a key answers without waiting on the old key's cleanup" */
  it("revokes the key at once and passes the skipped hold to its role's deletion", async () => {
    const { service, revoke, forget, deleteRole } = makeService({
      children: [],
      customRoleId: "cr_1",
    });

    const revoked = await service.revoke({
      id: LOGIN_ID,
      ...caller,
      cascadeToChildren: false,
      awaitProjection: false,
    });

    expect(revoked.revokedAt).not.toBeNull();
    expect(revoke).toHaveBeenCalledWith(expect.objectContaining({ id: LOGIN_ID }));
    expect(forget).toHaveBeenCalledWith(expect.objectContaining({ revoked: true }));
    expect(deleteRole).toHaveBeenCalledWith(
      expect.objectContaining({ roleId: "cr_1", awaitProjection: false }),
    );
  });
});
