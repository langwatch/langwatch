/**
 * Unit coverage for the CLI login key mint mechanics: re-login and racing logins never
 * leave more than one active key per device label.
 * Spec: specs/ai-governance/cli-onboarding/login-user-scoped-key.feature
 */
import { describe, expect, it, vi } from "vitest";
import type { ApiKeyLifecycleService } from "../api-key-lifecycle.service";
import type { ApiKeyGrantPolicyService } from "../api-key-grant-policy.service";
import type { ApiKeyRepository, StoredApiKey } from "../../repositories/api-key.repository";
import { ApiKeyCliService } from "../api-key-cli.service";

const OLD_KEY = {
  id: "apikey-old",
  name: "CLI login - laptop",
  createdByDeviceLabel: "laptop",
  createdAt: new Date("2026-01-01T00:00:00Z"),
} as unknown as StoredApiKey;

function serviceWith(options: {
  listForUser?: () => Promise<StoredApiKey[]>;
  createdKey?: { id: string; createdAt: Date };
  revoke?: (input: { id: string }) => Promise<unknown>;
}) {
  const revoke = vi.fn(options.revoke ?? (() => Promise.resolve()));
  const created = options.createdKey ?? { id: "apikey-new", createdAt: new Date("2026-01-02T00:00:00Z") };

  const repository = {
    listForUser: options.listForUser ?? (() => Promise.resolve([])),
  } as unknown as ApiKeyRepository;

  const lifecycle = {
    create: () => Promise.resolve({ token: "sk-lw-minted", apiKey: created }),
    revoke,
  } as unknown as ApiKeyLifecycleService;

  const policy = {} as unknown as ApiKeyGrantPolicyService;

  const service = ApiKeyCliService.create(
    {
      repository,
      authz: { listUserBindings: () => Promise.resolve([]) },
      projects: { listByOrganization: () => Promise.resolve({ data: [] }) },
    } as never,
    policy,
    lifecycle,
  );

  return { service, revoke, created };
}

describe("given a CLI login key mint", () => {
  describe("when the user logs in again from the same device", () => {
    /** @scenario "re-login from the same device replaces the previous CLI key" */
    it("revokes the previous key for that device label and keeps the new one", async () => {
      const { service, revoke, created } = serviceWith({
        listForUser: () => Promise.resolve([OLD_KEY]),
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
      const staleKey = {
        id: "apikey-stale",
        name: "CLI login - laptop",
        createdByDeviceLabel: "laptop",
        createdAt: new Date("2025-12-31T00:00:00Z"),
      } as unknown as StoredApiKey;
      const firstKey = {
        id: "apikey-first",
        name: "CLI login - laptop",
        createdByDeviceLabel: "laptop",
        createdAt: new Date("2026-01-01T00:00:00Z"),
      } as unknown as StoredApiKey;
      const secondKey = {
        id: "apikey-second",
        name: "CLI login - laptop",
        createdByDeviceLabel: "laptop",
        createdAt: new Date("2026-01-01T00:00:05Z"),
      } as unknown as StoredApiKey;

      const { service, revoke } = serviceWith({
        listForUser: () => Promise.resolve([staleKey, firstKey, secondKey]),
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
        createdBefore: firstKey.createdAt,
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
        listForUser: () => Promise.resolve([OLD_KEY]),
        revoke: (input: { id: string }) => {
          if (input.id === OLD_KEY.id) return Promise.reject(deviceRevokeError);
          return Promise.resolve();
        },
      });

      await expect(
        service.mintCliLoginKey({
          userId: "user-1",
          organizationId: "org-1",
          deviceLabel: "laptop",
          selection: { bindings: [{ scopeType: "ORGANIZATION", scopeId: "org-1" }], permissions: [] },
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
});
