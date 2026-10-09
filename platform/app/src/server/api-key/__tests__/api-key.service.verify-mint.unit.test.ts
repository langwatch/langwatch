import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ApiKeyWithBindings } from "../api-key.repository";
import { ApiKeyService } from "../api-key.service";
import { resetLegacyMintGuardForTests } from "../legacy-grant-mint";
import { serviceKey } from "./legacy-grant-mint.fixtures";

vi.mock("../api-key-token.utils", () => ({
  generateApiKeyToken: vi.fn(),
  splitApiKeyToken: () => ({ lookupId: "lookup_1", secret: "secret" }),
  verifySecret: () => "match",
  hashSecret: () => "hashed",
  INGEST_KEY_PREFIX: "ik-lw-",
}));

describe("API key verification", () => {
  beforeEach(() => {
    resetLegacyMintGuardForTests();
  });

  function serviceWith({
    apiKey,
    mintLegacyGrant,
    parent = { revokedAt: null, expiresAt: null },
  }: {
    apiKey: ApiKeyWithBindings | null;
    mintLegacyGrant: (args: { apiKey: ApiKeyWithBindings }) => void;
    parent?: { revokedAt: Date | null; expiresAt: Date | null } | null;
  }) {
    const repo = {
      findByLookupId: vi.fn().mockResolvedValue(apiKey),
      upgradeHash: vi.fn().mockResolvedValue(undefined),
      findLivenessById: vi.fn().mockResolvedValue(parent),
    };
    return new ApiKeyService({
      prisma: {} as never,
      repo: repo as never,
      roleRepo: {} as never,
      mintLegacyGrant,
    });
  }

  describe("when a legacy key verifies", () => {
    /** @scenario "A legacy service key states its access the first time it is used" */
    it("mints its grant on the resolution path", async () => {
      const mintLegacyGrant = vi.fn();
      const apiKey = serviceKey();
      const service = serviceWith({ apiKey, mintLegacyGrant });

      await expect(service.verify({ token: "sk-lw-x_y" })).resolves.toBe(
        apiKey,
      );

      expect(mintLegacyGrant).toHaveBeenCalledWith({ apiKey });
    });
  });

  describe("when the credential does not resolve", () => {
    it("mints nothing", async () => {
      const mintLegacyGrant = vi.fn();
      const service = serviceWith({ apiKey: null, mintLegacyGrant });

      await expect(service.verify({ token: "sk-lw-x_y" })).resolves.toBeNull();

      expect(mintLegacyGrant).not.toHaveBeenCalled();
    });
  });

  describe("when a revoked key is presented", () => {
    it("mints nothing", async () => {
      const mintLegacyGrant = vi.fn();
      const service = serviceWith({
        apiKey: serviceKey({ revokedAt: new Date() }),
        mintLegacyGrant,
      });

      await expect(service.verify({ token: "sk-lw-x_y" })).resolves.toBeNull();

      expect(mintLegacyGrant).not.toHaveBeenCalled();
    });
  });

  /**
   * The cascade is one caller's work; the credential must not depend on it
   * having run. These pin the rule at the only place that authenticates.
   */
  describe("given a key minted under a CLI login key", () => {
    function childKey(): ApiKeyWithBindings {
      return { ...serviceKey(), parentApiKeyId: "ak_login" };
    }

    /** @scenario "A key whose session is gone does not authenticate" */
    it("refuses it once that login key is revoked, however the revoke happened", async () => {
      const service = serviceWith({
        apiKey: childKey(),
        mintLegacyGrant: vi.fn(),
        parent: { revokedAt: new Date(), expiresAt: null },
      });

      await expect(service.verify({ token: "ik-lw-x_y" })).resolves.toBeNull();
    });

    /** @scenario "A key whose session is gone does not authenticate" */
    it("refuses it once that login key's session window has passed", async () => {
      const service = serviceWith({
        apiKey: childKey(),
        mintLegacyGrant: vi.fn(),
        parent: { revokedAt: null, expiresAt: new Date(Date.now() - 1_000) },
      });

      await expect(service.verify({ token: "ik-lw-x_y" })).resolves.toBeNull();
    });

    it("refuses it when the login key row is gone entirely", async () => {
      const service = serviceWith({
        apiKey: childKey(),
        mintLegacyGrant: vi.fn(),
        parent: null,
      });

      await expect(service.verify({ token: "ik-lw-x_y" })).resolves.toBeNull();
    });

    it("accepts it while that login key is live", async () => {
      const apiKey = childKey();
      const service = serviceWith({
        apiKey,
        mintLegacyGrant: vi.fn(),
        parent: { revokedAt: null, expiresAt: new Date(Date.now() + 60_000) },
      });

      await expect(service.verify({ token: "ik-lw-x_y" })).resolves.toBe(
        apiKey,
      );
    });
  });

  describe("given a key with no login key behind it", () => {
    it("does not go looking for a parent at all", async () => {
      const apiKey = serviceKey();
      const service = serviceWith({ apiKey, mintLegacyGrant: vi.fn() });

      await expect(service.verify({ token: "sk-lw-x_y" })).resolves.toBe(
        apiKey,
      );
    });
  });
});
