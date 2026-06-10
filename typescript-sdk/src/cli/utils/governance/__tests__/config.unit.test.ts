import { describe, it, expect, beforeEach, afterEach } from "vitest";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import {
  configPath,
  loadConfig,
  saveConfig,
  clearConfig,
  isLoggedIn,
  isCanonicalVkSecret,
} from "../config";

const tmpFile = (): string => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "lw-cfg-"));
  return path.join(dir, "config.json");
};

describe("governance config persistence", () => {
  let prev: string | undefined;
  let p: string;

  beforeEach(() => {
    prev = process.env.LANGWATCH_CLI_CONFIG;
    p = tmpFile();
    process.env.LANGWATCH_CLI_CONFIG = p;
  });
  afterEach(() => {
    if (prev === undefined) delete process.env.LANGWATCH_CLI_CONFIG;
    else process.env.LANGWATCH_CLI_CONFIG = prev;
  });

  it("returns defaults when no file exists", () => {
    expect(fs.existsSync(p)).toBe(false);
    const cfg = loadConfig();
    expect(cfg.gateway_url).toMatch(/^https?:\/\//);
    expect(cfg.control_plane_url).toMatch(/^https?:\/\//);
    expect(isLoggedIn(cfg)).toBe(false);
  });

  describe("self-hosted gateway-URL inference", () => {
    let prevEndpoint: string | undefined;
    let prevGateway: string | undefined;
    beforeEach(() => {
      prevEndpoint = process.env.LANGWATCH_ENDPOINT;
      prevGateway = process.env.LANGWATCH_GATEWAY_URL;
      delete process.env.LANGWATCH_GATEWAY_URL;
    });
    afterEach(() => {
      if (prevEndpoint === undefined) delete process.env.LANGWATCH_ENDPOINT;
      else process.env.LANGWATCH_ENDPOINT = prevEndpoint;
      if (prevGateway === undefined) delete process.env.LANGWATCH_GATEWAY_URL;
      else process.env.LANGWATCH_GATEWAY_URL = prevGateway;
    });

    it("defaults gateway to localhost:5563 when LANGWATCH_ENDPOINT is localhost", () => {
      process.env.LANGWATCH_ENDPOINT = "http://localhost:5560";
      const cfg = loadConfig();
      expect(cfg.gateway_url).toBe("http://localhost:5563");
    });

    it("defaults gateway to localhost:5563 when LANGWATCH_ENDPOINT is 127.0.0.1", () => {
      process.env.LANGWATCH_ENDPOINT = "http://127.0.0.1:5560";
      const cfg = loadConfig();
      expect(cfg.gateway_url).toBe("http://localhost:5563");
    });

    it("defaults gateway to production when LANGWATCH_ENDPOINT is unset", () => {
      delete process.env.LANGWATCH_ENDPOINT;
      const cfg = loadConfig();
      expect(cfg.gateway_url).toBe("https://gateway.langwatch.ai");
    });

    it("explicit LANGWATCH_GATEWAY_URL always wins regardless of endpoint", () => {
      process.env.LANGWATCH_ENDPOINT = "http://localhost:5560";
      process.env.LANGWATCH_GATEWAY_URL = "https://custom.example/v1";
      const cfg = loadConfig();
      expect(cfg.gateway_url).toBe("https://custom.example/v1");
    });
  });

  it("save → load roundtrip preserves all fields, file is mode 0600", () => {
    const original = {
      gateway_url: "http://gw.example",
      control_plane_url: "http://app.example",
      access_token: "at_x",
      refresh_token: "rt_x",
      expires_at: 1700000000,
      user: { id: "u_1", email: "j@x.com", name: "Jane" },
      organization: { id: "o_1", slug: "miro", name: "Miro" },
      default_personal_vk: {
        id: "vk_1",
        secret: "vk-lw-01HZX9N4TESTULIDTESTULID00",
        prefix: "vk-lw-01HZX9N",
      },
      last_request_increase_url: "http://app.example/me/budget/request?signed=abc",
    };
    saveConfig(original);

    const stat = fs.statSync(p);
    expect(stat.mode & 0o777).toBe(0o600);

    const loaded = loadConfig();
    expect(loaded).toEqual(expect.objectContaining(original));
    expect(isLoggedIn(loaded)).toBe(true);
  });

  describe("when a stored personal VK secret is in a legacy format", () => {
    it("drops the stale default_personal_vk block on load", () => {
      // Legacy `lw_vk_live_` secrets predate the canonical `vk-lw-` format
      // and route every gateway call to a malformed_key 401. loadConfig
      // must drop them so the wrapper preflight prompts a fresh login.
      fs.writeFileSync(
        p,
        JSON.stringify({
          gateway_url: "http://gw.example",
          control_plane_url: "http://app.example",
          access_token: "at_x",
          default_personal_vk: {
            id: "vk_legacy",
            secret: "lw_vk_live_01KQX0YJTSTALELEGACYSECRET",
            prefix: "lw_vk_live_",
          },
        }),
      );
      const loaded = loadConfig();
      expect(loaded.default_personal_vk).toBeUndefined();
      // Session itself is untouched — only the poisoned VK is dropped.
      expect(loaded.access_token).toBe("at_x");
    });

    it("keeps a canonical vk-lw- secret intact", () => {
      fs.writeFileSync(
        p,
        JSON.stringify({
          gateway_url: "http://gw.example",
          control_plane_url: "http://app.example",
          default_personal_vk: {
            id: "vk_ok",
            secret: "vk-lw-01HZX9N4TESTULIDTESTULID00",
            prefix: "vk-lw-01HZX9N",
          },
        }),
      );
      const loaded = loadConfig();
      expect(loaded.default_personal_vk?.secret).toBe(
        "vk-lw-01HZX9N4TESTULIDTESTULID00",
      );
    });
  });

  describe("isCanonicalVkSecret", () => {
    it("accepts vk-lw- prefixed secrets", () => {
      expect(isCanonicalVkSecret("vk-lw-01HZX9N4ABCDEF")).toBe(true);
    });
    it("rejects legacy lw_vk_live_ secrets", () => {
      expect(isCanonicalVkSecret("lw_vk_live_01KQX0YJ")).toBe(false);
    });
    it("rejects undefined / empty", () => {
      expect(isCanonicalVkSecret(undefined)).toBe(false);
      expect(isCanonicalVkSecret("")).toBe(false);
    });
  });

  it("env var override changes the path", () => {
    expect(configPath()).toBe(p);
  });

  it("clear removes the file (idempotent on missing)", () => {
    saveConfig({ gateway_url: "x", control_plane_url: "y", access_token: "at" });
    expect(fs.existsSync(p)).toBe(true);
    clearConfig();
    expect(fs.existsSync(p)).toBe(false);
    // Second call must not throw
    expect(() => clearConfig()).not.toThrow();
  });
});
