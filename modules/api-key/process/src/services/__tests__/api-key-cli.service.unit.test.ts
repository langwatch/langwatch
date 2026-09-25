import { createApiFixture } from "@langwatch/api-fixture";
import { fromDate } from "@langwatch/time";
/**
 * Unit coverage for the CLI login key mint mechanics: re-login and racing logins never
 * leave more than one active key per device label.
 * Spec: specs/ai-governance/cli-onboarding/login-user-scoped-key.feature
 */
import { describe, expect, it, vi } from "vitest";

import type { StoredApiKey } from "../../repositories/api-key.repository.ts";
import { MemoryApiKeyDatabase } from "../../repositories/memory/memory.api-key.database.ts";
import { MemoryApiKeyRepository } from "../../repositories/memory/memory.api-key.repository.ts";
import { ApiKeyCliService } from "../api-key-cli.service.ts";
import type { ApiKeyGrantPolicyService } from "../api-key-grant-policy.service.ts";
import type { ApiKeyLifecycleService } from "../api-key-lifecycle.service.ts";

function loginKey(overrides: Pick<StoredApiKey, "id" | "createdAt">): StoredApiKey {
  return {
    name: "CLI login - laptop",
    description: null,
    organizationId: "org_1",
    userId: "user_1",
    createdByUserId: "user_1",
    createdByDeviceLabel: "laptop",
    parentApiKeyId: null,
    lookupId: "lookup",
    permissionMode: "all",
    expiresAt: null,
    revokedAt: null,
    revocationCause: null,
    lastUsedAt: null,
    ingestSourceType: null,
    ingestionTemplateId: null,
    updatedAt: overrides.createdAt,
    roleBindings: [],
    hashedSecret: "hashed",
    ...overrides,
  };
}

const OLD_KEY = loginKey({ id: "apikey-old", createdAt: new Date("2026-01-01T00:00:00Z") });

function revokedKey(id: string): StoredApiKey {
  return loginKey({ id, createdAt: new Date("2026-01-01T00:00:00Z") });
}

function serviceWith(options: {
  findForUser?: () => Promise<StoredApiKey[]>;
  createdKey?: { id: string; createdAt: Date };
  revoke?: ApiKeyLifecycleService["revoke"];
  extendLoginKeyExpiry?: (input: unknown) => Promise<void>;
}) {
  const revoke = vi.fn(options.revoke ?? ((input) => Promise.resolve(revokedKey(input.id))));
  const create = vi.fn();
  const extendLoginKeyExpiry = vi.fn(options.extendLoginKeyExpiry ?? (() => Promise.resolve()));
  const created = options.createdKey ?? {
    id: "apikey-new",
    createdAt: new Date("2026-01-02T00:00:00Z"),
  };
  create.mockResolvedValue({ token: "sk-lw-minted", apiKey: created });

  const repository = Object.assign(
    MemoryApiKeyRepository.create({ memory: MemoryApiKeyDatabase.create() }),
    {
      findForUser: options.findForUser ?? (() => Promise.resolve([])),
      extendLoginKeyExpiry,
    },
  );

  const lifecycle = createApiFixture<ApiKeyLifecycleService>({ create, revoke });

  const policy = createApiFixture<ApiKeyGrantPolicyService>();

  const service = ApiKeyCliService.create(
    {
      repository,
      authz: { listUserBindings: () => Promise.resolve([]) },
      projects: { listByOrganization: () => Promise.resolve({ data: [] }) },
    } as never,
    policy,
    lifecycle,
  );

  return { service, revoke, create, created, extendLoginKeyExpiry };
}

describe("given a CLI login key mint", () => {
  describe("when the exchange reports what it minted", () => {
    /** @scenario "the exchange reports the permissions the key was minted with" */
    it("answers the selected permissions on the scope summary, deduplicated and sorted", async () => {
      const { service } = serviceWith({});

      const minted = await service.mintCliLoginKey({
        userId: "user-1",
        organizationId: "org-1",
        deviceLabel: "laptop",
        selection: {
          bindings: [{ scopeType: "ORGANIZATION", scopeId: "org-1" }],
          permissions: ["traces:view", "project:manage", "traces:view"],
        },
      });

      expect(minted.scope).toEqual({
        kind: "organization",
        projectIds: [],
        permissions: ["project:manage", "traces:view"],
      });
    });
  });

  describe("when the user logs in again from the same device", () => {
    /** @scenario "re-login from the same device replaces the previous CLI key" */
    /** @scenario "A re-login from the same device retires the keys of the session it replaces" */
    it("revokes the previous key for that device label and keeps the new one", async () => {
      const { service, revoke, created } = serviceWith({
        findForUser: () => Promise.resolve([OLD_KEY]),
      });

      await service.mintCliLoginKey({
        userId: "user-1",
        organizationId: "org-1",
        deviceLabel: "laptop",
        selection: { bindings: [{ scopeType: "ORGANIZATION", scopeId: "org-1" }], permissions: [] },
      });

      expect(revoke).toHaveBeenCalledTimes(1);
      expect(revoke.mock.calls[0]?.[0]).toMatchObject({ id: OLD_KEY.id });
      expect(revoke.mock.calls[0]?.[0]).not.toMatchObject({ id: created.id });
    });
  });

  describe("when two logins for one device label race", () => {
    /** @scenario "two logins racing on one device leave the newer key alive" */
    it("revokes only the keys created before its own mint", async () => {
      const staleKey = loginKey({
        id: "apikey-stale",
        createdAt: new Date("2025-12-31T00:00:00Z"),
      });
      const firstKey = loginKey({
        id: "apikey-first",
        createdAt: new Date("2026-01-01T00:00:00Z"),
      });
      const secondKey = loginKey({
        id: "apikey-second",
        createdAt: new Date("2026-01-01T00:00:05Z"),
      });

      const { service, revoke } = serviceWith({
        findForUser: () => Promise.resolve([staleKey, firstKey, secondKey]),
      });

      // The first exchange's revoke, arriving after the second mint already
      // landed: excluding only its own key is not enough without the
      // createdBefore bound, which would revoke the key the second exchange
      // just handed to the CLI.
      await service.revokeCliLoginKeysForDevice({
        userId: "user-1",
        organizationId: "org-1",
        deviceLabel: "laptop",
        exceptApiKeyId: firstKey.id,
        createdBefore: fromDate(firstKey.createdAt),
      });

      expect(revoke).toHaveBeenCalledTimes(1);
      expect(revoke).toHaveBeenCalledWith(expect.objectContaining({ id: staleKey.id }));
      expect(revoke).not.toHaveBeenCalledWith(expect.objectContaining({ id: secondKey.id }));
      expect(revoke).not.toHaveBeenCalledWith(expect.objectContaining({ id: firstKey.id }));
    });
  });

  describe("when a re-login from the same device fails at the mint", () => {
    /** @scenario "a failed re-login leaves the previous key working" */
    it("rolls back the just-created key without ever revoking the previous one", async () => {
      const deviceRevokeError = new Error("revoke failed");
      const { service, revoke, created } = serviceWith({
        findForUser: () => Promise.resolve([OLD_KEY]),
        revoke: (input) => {
          if (input.id === OLD_KEY.id) return Promise.reject(deviceRevokeError);
          return Promise.resolve(revokedKey(input.id));
        },
      });

      await expect(
        service.mintCliLoginKey({
          userId: "user-1",
          organizationId: "org-1",
          deviceLabel: "laptop",
          selection: {
            bindings: [{ scopeType: "ORGANIZATION", scopeId: "org-1" }],
            permissions: [],
          },
        }),
      ).rejects.toThrow(deviceRevokeError);

      // The replacement created before the key it replaces is revoked: the
      // failed device-revoke rolls the new key back rather than leaving it
      // half-minted, and the old key's revoke attempt failed, so it stays
      // active — no successful revoke call ever named it.
      expect(revoke).toHaveBeenCalledWith(expect.objectContaining({ id: created.id }));
      const oldKeyRevokeAttempts = revoke.mock.results.filter(
        (_, index) => revoke.mock.calls[index]?.[0]?.id === OLD_KEY.id,
      );
      expect(oldKeyRevokeAttempts).toHaveLength(1);
    });
  });

  describe("when the user logs in again from the same device", () => {
    it("revokes the previous key with cause rotation, not a person's own decision", async () => {
      const { service, revoke } = serviceWith({
        findForUser: () => Promise.resolve([OLD_KEY]),
      });

      await service.mintCliLoginKey({
        userId: "user-1",
        organizationId: "org-1",
        deviceLabel: "laptop",
        selection: { bindings: [{ scopeType: "ORGANIZATION", scopeId: "org-1" }], permissions: [] },
      });

      expect(revoke).toHaveBeenCalledWith(
        expect.objectContaining({ id: OLD_KEY.id, cause: "rotation" }),
      );
    });
  });

  describe("given session timing", () => {
    /** @scenario "A session's login-key expiry tracks the sooner of the refresh window and the org ceiling" */
    it("mints the login key with an expiry when session timing is supplied", async () => {
      const { service, create } = serviceWith({});

      await service.mintCliLoginKey({
        userId: "user-1",
        organizationId: "org-1",
        deviceLabel: "laptop",
        selection: { bindings: [{ scopeType: "ORGANIZATION", scopeId: "org-1" }], permissions: [] },
        sessionStartedAtMs: 1_000_000,
        maxSessionDurationDays: 0,
        refreshWindowMs: 60_000,
      });

      expect(create.mock.calls[0]![0]).toMatchObject({ expiresAt: new Date(1_000_000 + 60_000) });
    });

    it("mints with no expiry when session timing is omitted, as before", async () => {
      const { service, create } = serviceWith({});

      await service.mintCliLoginKey({
        userId: "user-1",
        organizationId: "org-1",
        deviceLabel: "laptop",
        selection: { bindings: [{ scopeType: "ORGANIZATION", scopeId: "org-1" }], permissions: [] },
      });

      expect(create.mock.calls[0]![0]).not.toHaveProperty("expiresAt");
    });
  });

  describe("when a CLI login key's expiry is extended", () => {
    /** @scenario "A session's login-key expiry tracks the sooner of the refresh window and the org ceiling" */
    it("moves the key's expiry to the new refresh window through the repository", async () => {
      const { service, extendLoginKeyExpiry } = serviceWith({});

      await service.extendCliLoginKeyExpiry({
        apiKeyId: "apikey-1",
        userId: "user-1",
        organizationId: "org-1",
        sessionStartedAtMs: Date.now() - 1000,
        maxSessionDurationDays: 0,
        refreshWindowMs: 60_000,
      });

      expect(extendLoginKeyExpiry).toHaveBeenCalledWith(
        expect.objectContaining({ id: "apikey-1", organizationId: "org-1", userId: "user-1" }),
      );
    });
  });
});
