import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import {
  initConfig,
  getConfig,
  requireApiKey,
  runWithConfig,
} from "../config.js";

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
      // globalThis survives vi.resetModules(), so clear it explicitly
      delete (globalThis as Record<string, unknown>).__langwatch_mcp_config;
      delete (globalThis as Record<string, unknown>).__langwatch_mcp_config_storage;
      vi.resetModules();
      const freshConfig = await import("../config.js");
      expect(() => freshConfig.getConfig()).toThrow("Config not initialized");
    });
  });

  describe("runWithConfig()", () => {
    it("overrides global config within the callback", () => {
      initConfig({ apiKey: "global-key" });

      runWithConfig(
        { apiKey: "session-key", endpoint: "https://session.example.com" },
        () => {
          expect(getConfig().apiKey).toBe("session-key");
          expect(getConfig().endpoint).toBe("https://session.example.com");
        }
      );
    });

    it("restores global config after the callback completes", () => {
      initConfig({ apiKey: "global-key" });

      runWithConfig(
        { apiKey: "session-key", endpoint: "https://session.example.com" },
        () => {
          // inside: session config
        }
      );

      expect(getConfig().apiKey).toBe("global-key");
    });

    it("isolates concurrent async contexts", async () => {
      initConfig({ apiKey: "global-key" });

      const results: string[] = [];

      await Promise.all([
        runWithConfig(
          { apiKey: "key-a", endpoint: "https://a.example.com" },
          async () => {
            await new Promise((r) => setTimeout(r, 10));
            results.push(requireApiKey());
          }
        ),
        runWithConfig(
          { apiKey: "key-b", endpoint: "https://b.example.com" },
          async () => {
            await new Promise((r) => setTimeout(r, 5));
            results.push(requireApiKey());
          }
        ),
      ]);

      expect(results).toContain("key-a");
      expect(results).toContain("key-b");
    });

    it("returns the callback result", () => {
      initConfig({});
      const result = runWithConfig(
        { apiKey: "key", endpoint: "https://example.com" },
        () => 42
      );
      expect(result).toBe(42);
    });

    it("makes requireApiKey() use the scoped key", () => {
      initConfig({});
      runWithConfig(
        { apiKey: "scoped-key", endpoint: "https://example.com" },
        () => {
          expect(requireApiKey()).toBe("scoped-key");
        }
      );
    });
  });
});
