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

  it("save → load roundtrip preserves all fields, file is mode 0600", () => {
    const original = {
      gateway_url: "http://gw.example",
      control_plane_url: "http://app.example",
      access_token: "at_x",
      refresh_token: "rt_x",
      expires_at: 1700000000,
      user: { id: "u_1", email: "j@x.com", name: "Jane" },
      organization: { id: "o_1", slug: "miro", name: "Miro" },
      default_personal_vk: { id: "vk_1", secret: "lw_vk_test", prefix: "lw_vk_t" },
      last_request_increase_url: "http://app.example/me/budget/request?signed=abc",
    };
    saveConfig(original);

    const stat = fs.statSync(p);
    expect(stat.mode & 0o777).toBe(0o600);

    const loaded = loadConfig();
    expect(loaded).toEqual(expect.objectContaining(original));
    expect(isLoggedIn(loaded)).toBe(true);
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
