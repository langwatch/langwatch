import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { initConfig, getConfig, requireApiKey } from "../config.js";

describe("config", () => {
  let originalApiKey: string | undefined;
  let originalEndpoint: string | undefined;

  beforeEach(() => {
    originalApiKey = process.env.LANGWATCH_API_KEY;
    originalEndpoint = process.env.LANGWATCH_ENDPOINT;
    delete process.env.LANGWATCH_API_KEY;
    delete process.env.LANGWATCH_ENDPOINT;
  });

  afterEach(() => {
    if (originalApiKey !== undefined) {
      process.env.LANGWATCH_API_KEY = originalApiKey;
    } else {
      delete process.env.LANGWATCH_API_KEY;
    }
    if (originalEndpoint !== undefined) {
      process.env.LANGWATCH_ENDPOINT = originalEndpoint;
    } else {
      delete process.env.LANGWATCH_ENDPOINT;
    }
  });

  describe("when CLI args are provided", () => {
    it("uses CLI apiKey over env var", () => {
      process.env.LANGWATCH_API_KEY = "env-key";
      initConfig({ apiKey: "cli-key" });
      expect(getConfig().apiKey).toBe("cli-key");
    });

    it("uses CLI endpoint over env var", () => {
      process.env.LANGWATCH_ENDPOINT = "https://env.example.com";
      initConfig({ endpoint: "https://cli.example.com" });
      expect(getConfig().endpoint).toBe("https://cli.example.com");
    });
  });

  describe("when CLI args are missing", () => {
    it("falls back to LANGWATCH_API_KEY env var", () => {
      process.env.LANGWATCH_API_KEY = "env-key";
      initConfig({});
      expect(getConfig().apiKey).toBe("env-key");
    });

    it("falls back to LANGWATCH_ENDPOINT env var", () => {
      process.env.LANGWATCH_ENDPOINT = "https://env.example.com";
      initConfig({});
      expect(getConfig().endpoint).toBe("https://env.example.com");
    });
  });

  describe("when no args or env vars are provided", () => {
    it("defaults endpoint to https://app.langwatch.ai", () => {
      initConfig({});
      expect(getConfig().endpoint).toBe("https://app.langwatch.ai");
    });

    it("leaves apiKey as undefined", () => {
      initConfig({});
      expect(getConfig().apiKey).toBeUndefined();
    });
  });

  describe("requireApiKey", () => {
    it("returns the API key when it is set", () => {
      initConfig({ apiKey: "test-key" });
      expect(requireApiKey()).toBe("test-key");
    });

    it("throws when no API key is provided", () => {
      initConfig({});
      expect(() => requireApiKey()).toThrow(
        "LANGWATCH_API_KEY is required. Set it via --apiKey flag or LANGWATCH_API_KEY environment variable."
      );
    });
  });

  describe("getConfig", () => {
    it("throws when config has not been initialized", async () => {
      vi.resetModules();
      const freshConfig = await import("../config.js");
      expect(() => freshConfig.getConfig()).toThrow("Config not initialized");
    });
  });
});
