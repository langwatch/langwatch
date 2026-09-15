/**
 * Project pinning for `langwatch instrument` and the wrapper `--project`
 * flag: the pin in `tool_project_keys[tool]` is what routes a tool's
 * telemetry to a team project instead of the personal workspace, and
 * what the wrapper and the login refresh treat as do-not-touch.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import * as cliApi from "../cli-api";
import type { GovernanceConfig } from "../config";
import * as configMod from "../config";
import { clearToolProjectPin, pinToolToKey, pinToolToProject } from "../project-scope";

vi.mock("../cli-api", async () => {
  const actual = await vi.importActual<typeof cliApi>("../cli-api");
  return { ...actual, mintProjectIngestionKey: vi.fn() };
});

vi.mock("../config", async () => {
  const actual = await vi.importActual<typeof configMod>("../config");
  return { ...actual, saveConfig: vi.fn() };
});

vi.mock("../device-label", () => ({
  deviceLabelForThisMachine: () => "test-device",
}));

function baseCfg(overrides: Partial<GovernanceConfig> = {}): GovernanceConfig {
  return {
    gateway_url: "http://gw.example.com",
    control_plane_url: "http://app.example.com",
    access_token: "tok",
    organization: { id: "o1", slug: "acme" },
    ...overrides,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("pinToolToProject", () => {
  describe("when the tool has an ingestion source type", () => {
    it("mints a project key for this device and stores the pin", async () => {
      (cliApi.mintProjectIngestionKey as ReturnType<typeof vi.fn>).mockResolvedValue({
        token: "ik-lw-projlookup000000_secret000000000000000000000",
        prefix: "ik-lw-projl",
        endpoint: "http://app.example.com/api/otel",
        project: { id: "proj_1", slug: "acme-app", name: "Acme App" },
      });
      const cfg = baseCfg();

      const out = await pinToolToProject({
        cfg,
        tool: "codex",
        project: "acme-app",
      });

      expect(cliApi.mintProjectIngestionKey).toHaveBeenCalledWith(cfg, {
        sourceType: "codex",
        project: "acme-app",
        deviceLabel: "test-device",
      });
      expect(cfg.tool_project_keys?.codex).toEqual({
        secret: "ik-lw-projlookup000000_secret000000000000000000000",
        project_id: "proj_1",
        project_slug: "acme-app",
      });
      expect(configMod.saveConfig).toHaveBeenCalledWith(cfg);
      expect(out).toEqual({ label: "acme-app" });
    });
  });

  describe("when the tool has no direct OTLP ingestion path", () => {
    it("refuses instead of minting a key nothing can use", async () => {
      await expect(
        pinToolToProject({ cfg: baseCfg(), tool: "cursor", project: "acme-app" }),
      ).rejects.toThrow(/--project is not supported for 'cursor'/);
      expect(cliApi.mintProjectIngestionKey).not.toHaveBeenCalled();
      expect(configMod.saveConfig).not.toHaveBeenCalled();
    });
  });
});

describe("pinToolToKey", () => {
  it("stores the pasted key with no server call", () => {
    const cfg = baseCfg();

    pinToolToKey({ cfg, tool: "claude", key: "sk-lw-pasted" });

    expect(cfg.tool_project_keys?.claude).toEqual({ secret: "sk-lw-pasted" });
    expect(cliApi.mintProjectIngestionKey).not.toHaveBeenCalled();
    expect(configMod.saveConfig).toHaveBeenCalledWith(cfg);
  });

  it("carries the endpoint only when one was given", () => {
    const cfg = baseCfg();

    pinToolToKey({
      cfg,
      tool: "codex",
      key: "sk-lw-pasted",
      endpoint: "https://lw.acme.dev",
    });

    expect(cfg.tool_project_keys?.codex).toEqual({
      secret: "sk-lw-pasted",
      endpoint: "https://lw.acme.dev",
    });
  });

  it("keeps other tools' pins intact", () => {
    const cfg = baseCfg({
      tool_project_keys: { codex: { secret: "sk-lw-other" } },
    });

    pinToolToKey({ cfg, tool: "claude", key: "sk-lw-pasted" });

    expect(cfg.tool_project_keys?.codex).toEqual({ secret: "sk-lw-other" });
    expect(cfg.tool_project_keys?.claude).toEqual({ secret: "sk-lw-pasted" });
  });
});

describe("clearToolProjectPin", () => {
  describe("when the tool has no pin", () => {
    it("returns false and persists nothing", () => {
      const cfg = baseCfg();

      expect(clearToolProjectPin({ cfg, tool: "codex" })).toBe(false);
      expect(configMod.saveConfig).not.toHaveBeenCalled();
    });
  });

  describe("when the tool is pinned", () => {
    it("removes only that tool's pin and persists", () => {
      const cfg = baseCfg({
        tool_project_keys: {
          codex: { secret: "sk-lw-a" },
          claude: { secret: "sk-lw-b" },
        },
      });

      expect(clearToolProjectPin({ cfg, tool: "codex" })).toBe(true);
      expect(cfg.tool_project_keys).toEqual({
        claude: { secret: "sk-lw-b" },
      });
      expect(configMod.saveConfig).toHaveBeenCalledWith(cfg);
    });
  });
});
