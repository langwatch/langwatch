import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { MockSecretsProvider, loadAppSecrets } from "../secrets";

describe("MockSecretsProvider", () => {
  const provider = new MockSecretsProvider({
    "langwatch/dev/app": JSON.stringify({ DATABASE_URL: "pg://test" }),
  });

  it("returns stored value", async () => {
    const raw = await provider.get("langwatch/dev/app");
    expect(JSON.parse(raw)).toEqual({ DATABASE_URL: "pg://test" });
  });

  it("throws for missing key", async () => {
    await expect(provider.get("missing")).rejects.toThrow("secret_not_found");
  });
});

describe("loadAppSecrets", () => {
  const originalEnv = { ...process.env };
  afterEach(() => {
    process.env = { ...originalEnv };
  });

  it("returns empty when provider is null", async () => {
    expect(
      await loadAppSecrets({ provider: null, environment: "dev" })
    ).toEqual({});
  });

  it("parses JSON blob from provider", async () => {
    const provider = new MockSecretsProvider({
      "langwatch/dev/app": JSON.stringify({
        DATABASE_URL: "pg://test",
        REDIS_URL: "redis://x",
      }),
    });
    const result = await loadAppSecrets({ provider, environment: "dev" });
    expect(result).toEqual({ DATABASE_URL: "pg://test", REDIS_URL: "redis://x" });
  });

  describe("when environment is prod", () => {
    it("refuses", async () => {
      const provider = new MockSecretsProvider({});
      await expect(
        loadAppSecrets({ provider, environment: "prod" })
      ).rejects.toThrow("REFUSED");
    });
  });

  describe("when environment is staging", () => {
    it("refuses", async () => {
      const provider = new MockSecretsProvider({});
      await expect(
        loadAppSecrets({ provider, environment: "staging" })
      ).rejects.toThrow("REFUSED");
    });
  });

  describe("when environment is production", () => {
    it("refuses", async () => {
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

    it("refuses", async () => {
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

    it("refuses", async () => {
      const provider = new MockSecretsProvider({
        "langwatch/dev/app": "{}",
      });
      await expect(
        loadAppSecrets({ provider, environment: "dev" })
      ).rejects.toThrow("REFUSED");
    });
  });
});
