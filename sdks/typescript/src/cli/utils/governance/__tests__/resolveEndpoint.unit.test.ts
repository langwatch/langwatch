/**
 * Unit tests for the single source of truth for control-plane endpoint
 * resolution. Locks the 4-source priority (flag > env > config > default)
 * and ensures every command that imports `resolveControlPlaneUrl()`
 * sees the same value for the same inputs.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import * as configMod from "../config";
import {
  resolveControlPlaneEndpoint,
  resolveControlPlaneUrl,
} from "../resolveEndpoint";

// Stub loadConfig so the tests don't leak the developer's local
// ~/.langwatch/config.json (which on a dogfooded box sets
// control_plane_url=http://localhost:5560). Tests that need a
// persisted config pass it explicitly via { cfg }.
vi.mock("../config", async () => {
  const actual = await vi.importActual<typeof configMod>("../config");
  return {
    ...actual,
    loadConfig: vi.fn(() => undefined as any),
  };
});

const ORIG_ENV = { ...process.env };

const cfgFixture = (overrides: Partial<{
  control_plane_url: string;
  gateway_url: string;
}> = {}): any => ({
  control_plane_url: "https://config.example.com",
  gateway_url: "https://gw.example.com",
  ...overrides,
});

describe("resolveControlPlaneEndpoint — 4-source priority", () => {
  beforeEach(() => {
    delete process.env.LANGWATCH_ENDPOINT;
    delete process.env.LANGWATCH_URL; // legacy alias dropped — must NOT be read
  });
  afterEach(() => {
    process.env = { ...ORIG_ENV };
    vi.restoreAllMocks();
  });

  describe("priority 1 — `--endpoint` flag wins over everything", () => {
    it("flag wins over env", () => {
      process.env.LANGWATCH_ENDPOINT = "https://env.example.com";
      const result = resolveControlPlaneEndpoint({
        flag: "https://flag.example.com",
        cfg: cfgFixture(),
      });
      expect(result.url).toBe("https://flag.example.com");
      expect(result.source).toBe("flag");
    });

    it("flag wins over persisted config", () => {
      const result = resolveControlPlaneEndpoint({
        flag: "https://flag.example.com",
        cfg: cfgFixture({ control_plane_url: "https://config.example.com" }),
      });
      expect(result.url).toBe("https://flag.example.com");
      expect(result.source).toBe("flag");
    });

    it("strips trailing slash from flag", () => {
      const result = resolveControlPlaneEndpoint({
        flag: "https://flag.example.com/",
        cfg: cfgFixture(),
      });
      expect(result.url).toBe("https://flag.example.com");
    });
  });

  describe("priority 2 — LANGWATCH_ENDPOINT env wins over config + default", () => {
    it("env wins over persisted config", () => {
      process.env.LANGWATCH_ENDPOINT = "https://env.example.com";
      const result = resolveControlPlaneEndpoint({
        cfg: cfgFixture({ control_plane_url: "https://config.example.com" }),
      });
      expect(result.url).toBe("https://env.example.com");
      expect(result.source).toBe("env");
    });

    it("strips trailing slash from env", () => {
      process.env.LANGWATCH_ENDPOINT = "https://env.example.com/";
      const result = resolveControlPlaneEndpoint({ cfg: cfgFixture() });
      expect(result.url).toBe("https://env.example.com");
    });

    it("ignores empty-string env (treats as unset)", () => {
      process.env.LANGWATCH_ENDPOINT = "";
      const result = resolveControlPlaneEndpoint({
        cfg: cfgFixture({ control_plane_url: "https://config.example.com" }),
      });
      expect(result.url).toBe("https://config.example.com");
      expect(result.source).toBe("config");
    });
  });

  describe("priority 3 — persisted config wins over default", () => {
    it("config wins when neither flag nor env is set", () => {
      const result = resolveControlPlaneEndpoint({
        cfg: cfgFixture({ control_plane_url: "https://config.example.com" }),
      });
      expect(result.url).toBe("https://config.example.com");
      expect(result.source).toBe("config");
    });

    it("config that EQUALS the default is treated as default (not user-chosen)", () => {
      const result = resolveControlPlaneEndpoint({
        cfg: cfgFixture({ control_plane_url: "https://app.langwatch.ai" }),
      });
      // The default-match heuristic prevents stale `~/.langwatch/config.json`
      // from a fresh install (where defaults() seeded the config) from
      // being treated as a user-set endpoint.
      expect(result.source).toBe("default");
    });
  });

  describe("priority 4 — built-in default", () => {
    it("default fires when nothing else is set", () => {
      const result = resolveControlPlaneEndpoint({});
      expect(result.url).toBe("https://app.langwatch.ai");
      expect(result.source).toBe("default");
    });
  });

  describe("LANGWATCH_URL legacy alias is DROPPED", () => {
    it("does NOT read LANGWATCH_URL even when LANGWATCH_ENDPOINT is unset", () => {
      process.env.LANGWATCH_URL = "https://legacy.example.com";
      const result = resolveControlPlaneEndpoint({});
      // Falls through to default — the alias is gone.
      expect(result.url).toBe("https://app.langwatch.ai");
      expect(result.source).toBe("default");
    });
  });

  describe("resolveControlPlaneUrl convenience", () => {
    /** @scenario every CLI command resolves the endpoint via the same single function */
    it("returns just the URL string", () => {
      process.env.LANGWATCH_ENDPOINT = "https://env.example.com";
      expect(resolveControlPlaneUrl()).toBe("https://env.example.com");
    });
  });
});
