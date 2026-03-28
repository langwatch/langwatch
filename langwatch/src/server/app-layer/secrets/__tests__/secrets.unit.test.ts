import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  MockSecretsProvider,
  loadAppSecrets,
  createSecretsProvider,
} from "../secrets";

vi.mock("~/utils/logger/server", () => ({
  createLogger: () => ({
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
    fatal: vi.fn(),
  }),
}));

describe("MockSecretsProvider", () => {
  const provider = new MockSecretsProvider({
    "langwatch/dev/app": JSON.stringify({ DATABASE_URL: "pg://test" }),
  });

  describe("when secret exists", () => {
    it("returns the stored value", async () => {
      const raw = await provider.get("langwatch/dev/app");
      expect(JSON.parse(raw)).toEqual({ DATABASE_URL: "pg://test" });
    });
  });

  describe("when secret is missing", () => {
    it("throws secret_not_found error", async () => {
      await expect(provider.get("missing")).rejects.toThrow("secret_not_found");
    });
  });
});

describe("createSecretsProvider", () => {
  const originalEnv = { ...process.env };
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe("when SECRETS_PROVIDER is unset", () => {
    it("returns null", () => {
      delete process.env.SECRETS_PROVIDER;
      expect(createSecretsProvider()).toBeNull();
    });
  });

  describe("when SECRETS_PROVIDER is 'env'", () => {
    it("returns null", () => {
      process.env.SECRETS_PROVIDER = "env";
      expect(createSecretsProvider()).toBeNull();
    });
  });

  describe("when SECRETS_PROVIDER is unknown", () => {
    it("throws with supported values", () => {
      process.env.SECRETS_PROVIDER = "vault";
      expect(() => createSecretsProvider()).toThrow(
        'Unknown SECRETS_PROVIDER: "vault"'
      );
    });
  });
});

describe("loadAppSecrets", () => {
  const originalEnv = { ...process.env };
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  describe("when provider is null", () => {
    it("returns empty record", async () => {
      expect(
        await loadAppSecrets({ provider: null, environment: "dev" })
      ).toEqual({});
    });
  });

  describe("when provider returns valid JSON blob", () => {
    it("parses and returns the secrets record", async () => {
      const provider = new MockSecretsProvider({
        "langwatch/dev/app": JSON.stringify({
          DATABASE_URL: "pg://test",
          REDIS_URL: "redis://x",
        }),
      });
      const result = await loadAppSecrets({ provider, environment: "dev" });
      expect(result).toEqual({
        DATABASE_URL: "pg://test",
        REDIS_URL: "redis://x",
      });
    });
  });

  describe("when provider returns malformed JSON", () => {
    it("rejects with parse error for non-object", async () => {
      const provider = new MockSecretsProvider({
        "langwatch/dev/app": '"just a string"',
      });
      await expect(
        loadAppSecrets({ provider, environment: "dev" })
      ).rejects.toThrow("Expected JSON object");
    });

    it("rejects with error for non-string values", async () => {
      const provider = new MockSecretsProvider({
        "langwatch/dev/app": JSON.stringify({ KEY: 123 }),
      });
      await expect(
        loadAppSecrets({ provider, environment: "dev" })
      ).rejects.toThrow('Key "KEY"');
    });

    it("rejects with error for array", async () => {
      const provider = new MockSecretsProvider({
        "langwatch/dev/app": "[]",
      });
      await expect(
        loadAppSecrets({ provider, environment: "dev" })
      ).rejects.toThrow("Expected JSON object");
    });
  });

  describe("when environment is prod", () => {
    it("rejects with REFUSED error", async () => {
      const provider = new MockSecretsProvider({});
      await expect(
        loadAppSecrets({ provider, environment: "prod" })
      ).rejects.toThrow("REFUSED");
    });
  });

  describe("when environment is staging", () => {
    it("rejects with REFUSED error", async () => {
      const provider = new MockSecretsProvider({});
      await expect(
        loadAppSecrets({ provider, environment: "staging" })
      ).rejects.toThrow("REFUSED");
    });
  });

  describe("when environment is production", () => {
    it("rejects with REFUSED error", async () => {
      const provider = new MockSecretsProvider({});
      await expect(
        loadAppSecrets({ provider, environment: "production" })
      ).rejects.toThrow("REFUSED");
    });
  });

  describe("when running in Kubernetes", () => {
    beforeEach(() => {
      process.env.KUBERNETES_SERVICE_HOST = "10.0.0.1";
    });

    it("rejects with REFUSED error", async () => {
      const provider = new MockSecretsProvider({
        "langwatch/dev/app": "{}",
      });
      await expect(
        loadAppSecrets({ provider, environment: "dev" })
      ).rejects.toThrow("REFUSED");
    });
  });

  describe("when NODE_ENV is production", () => {
    beforeEach(() => {
      (process.env as Record<string, string>).NODE_ENV = "production";
    });

    it("rejects with REFUSED error", async () => {
      const provider = new MockSecretsProvider({
        "langwatch/dev/app": "{}",
      });
      await expect(
        loadAppSecrets({ provider, environment: "dev" })
      ).rejects.toThrow("REFUSED");
    });
  });
});
