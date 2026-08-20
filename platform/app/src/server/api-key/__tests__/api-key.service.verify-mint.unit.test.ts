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
  }: {
    apiKey: ApiKeyWithBindings | null;
    mintLegacyGrant: (args: { apiKey: ApiKeyWithBindings }) => void;
  }) {
    const repo = {
      findByLookupId: vi.fn().mockResolvedValue(apiKey),
      upgradeHash: vi.fn().mockResolvedValue(undefined),
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
});
