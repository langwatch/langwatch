/**
 * refreshTelemetryWiringForLogin against the two logins that must not take over
 * wiring: one kept in a config file of its own, and one on this machine.
 */
import * as fs from "node:fs";
import * as path from "node:path";

import { describe, expect, it, vi } from "vitest";

import {
  codexGatewayBlockBaseUrl,
  defaultCodexConfigPath,
  writeCodexGatewayBlock,
  writeCodexOtelBlock,
} from "../../codex-config-toml";
import { appSettingsTargetFor, installAppEnv } from "../app-settings";
import * as cliApi from "../cli-api";
import { defaultConfigPath } from "../config";
import { buildOtelEnvBlock } from "../otel-env-block";
import { buildScopedToolFunction, persistBlockToRc, rcPath, toolMarkers } from "../shell-rc";
import { keptWiringLines, refreshTelemetryWiringForLogin } from "../telemetry-refresh";
import {
  baseCfg,
  CURRENT_ENDPOINT,
  installTempHomeAndCwd,
  STALE_ENDPOINT,
  STALE_TOKEN,
} from "./telemetry-refresh-test-helpers";

vi.mock("../running-code", () => ({ runningCodeRestartNotice: vi.fn() }));
vi.mock("../cli-api", async () => {
  const actual = await vi.importActual<typeof cliApi>("../cli-api");
  return { ...actual, mintIngestionKey: vi.fn(), listIngestionKeys: vi.fn() };
});

const temp = installTempHomeAndCwd();

const LOCAL_LOGIN_URL = "http://localhost:5560";
const LOCAL_ENDPOINT = `${LOCAL_LOGIN_URL}/api/otel`;
const OTHER_LOCAL_ENDPOINT = "http://localhost:5570/api/otel";

function localCfg() {
  return baseCfg({ control_plane_url: LOCAL_LOGIN_URL, gateway_url: "http://localhost:5563" });
}

function mintsAt(endpoint: string) {
  vi.mocked(cliApi.listIngestionKeys).mockResolvedValue([]);
  vi.mocked(cliApi.mintIngestionKey).mockImplementation(async (_cfg, sourceType) => ({
    token: `ik-lw-${sourceType.slice(0, 4)}000000000000_minted`,
    prefix: `ik-lw-${sourceType.slice(0, 4)}`,
    endpoint,
  }));
}

function wireClaudeAndCodex(endpoint: string) {
  installAppEnv(
    appSettingsTargetFor("claude")!,
    buildOtelEnvBlock("claude", endpoint, STALE_TOKEN),
  );
  writeCodexOtelBlock(
    { baseEndpoint: endpoint, ingestionToken: STALE_TOKEN },
    { persistAuthHeader: true },
  );
}

function claudeEnv() {
  return JSON.parse(fs.readFileSync(appSettingsTargetFor("claude")!.path, "utf8")).env;
}

function snapshotOfWiring() {
  return {
    claude: fs.readFileSync(appSettingsTargetFor("claude")!.path, "utf8"),
    codex: fs.readFileSync(defaultCodexConfigPath(), "utf8"),
  };
}

describe("a login kept in its own config file", () => {
  describe("when persisted wiring points at another instance", () => {
    /** @scenario "A login kept in its own config file never touches the home's wiring" */
    it("mints nothing, rewrites nothing and reports the tools left alone", async () => {
      process.env.LANGWATCH_CLI_CONFIG = path.join(temp.cwd, "own-config.json");
      wireClaudeAndCodex(STALE_ENDPOINT);
      mintsAt(CURRENT_ENDPOINT);
      const before = snapshotOfWiring();

      const result = await refreshTelemetryWiringForLogin(baseCfg());

      expect(cliApi.mintIngestionKey).not.toHaveBeenCalled();
      expect(snapshotOfWiring()).toEqual(before);
      expect(result.kept?.reason).toBe("isolated_config");
      expect(result.kept?.tools).toEqual(expect.arrayContaining(["claude", "codex"]));
    });
  });
});

describe("a config file named as the home's default", () => {
  describe("when persisted wiring points at a previous instance", () => {
    /** @scenario "LANGWATCH_CLI_CONFIG naming the home's default file is the machine's login" */
    it("rewrites the wiring with the new instance's endpoint", async () => {
      process.env.LANGWATCH_CLI_CONFIG = defaultConfigPath();
      installAppEnv(
        appSettingsTargetFor("claude")!,
        buildOtelEnvBlock("claude", STALE_ENDPOINT, STALE_TOKEN),
      );
      mintsAt(CURRENT_ENDPOINT);

      await refreshTelemetryWiringForLogin(baseCfg());

      expect(claudeEnv().OTEL_EXPORTER_OTLP_ENDPOINT).toBe(CURRENT_ENDPOINT);
    });
  });
});

describe("a login on this machine", () => {
  describe("when persisted wiring reports to a deployment elsewhere", () => {
    /** @scenario "A login on this machine does not take over wiring that reports elsewhere" */
    it("mints nothing, rewrites nothing and reports the tools left alone", async () => {
      wireClaudeAndCodex(STALE_ENDPOINT);
      mintsAt(LOCAL_ENDPOINT);
      const before = snapshotOfWiring();

      const result = await refreshTelemetryWiringForLogin(localCfg());

      expect(cliApi.mintIngestionKey).not.toHaveBeenCalled();
      expect(snapshotOfWiring()).toEqual(before);
      expect(result.kept?.reason).toBe("loopback_login");
      expect(result.kept?.tools).toEqual(expect.arrayContaining(["claude", "codex"]));
    });
  });

  describe("when persisted wiring already reports to another port on this machine", () => {
    /** @scenario "A login on this machine still refreshes wiring that already reports to this machine" */
    it("rewrites the wiring with the new endpoint and a live ingest key", async () => {
      installAppEnv(
        appSettingsTargetFor("claude")!,
        buildOtelEnvBlock("claude", OTHER_LOCAL_ENDPOINT, STALE_TOKEN),
      );
      mintsAt(LOCAL_ENDPOINT);

      await refreshTelemetryWiringForLogin(localCfg());

      expect(claudeEnv().OTEL_EXPORTER_OTLP_ENDPOINT).toBe(LOCAL_ENDPOINT);
      expect(claudeEnv().OTEL_EXPORTER_OTLP_HEADERS).toContain("minted");
    });
  });

  describe("when a shell function reports to a host that only starts with localhost", () => {
    /** @scenario "A host that only starts with localhost is not this machine" */
    it("leaves the shell function as it was and reports the tool left alone", async () => {
      const lookalike = "https://localhost.acme.test/api/otel";
      persistBlockToRc(
        "zsh",
        buildScopedToolFunction(
          "gemini",
          buildOtelEnvBlock("gemini", lookalike, STALE_TOKEN),
          "zsh",
        ),
        toolMarkers("gemini"),
      );
      mintsAt(LOCAL_ENDPOINT);
      const before = fs.readFileSync(rcPath("zsh"), "utf8");

      const result = await refreshTelemetryWiringForLogin(localCfg());

      expect(fs.readFileSync(rcPath("zsh"), "utf8")).toBe(before);
      expect(result.kept).toEqual({ tools: ["gemini"], reason: "loopback_login" });
    });
  });

  describe("when a shell function reports to another port on this machine", () => {
    /** @scenario "A shell function that reports to this machine is refreshed by a login on this machine" */
    it("rewrites the shell function with the new endpoint", async () => {
      persistBlockToRc(
        "zsh",
        buildScopedToolFunction(
          "gemini",
          buildOtelEnvBlock("gemini", OTHER_LOCAL_ENDPOINT, STALE_TOKEN),
          "zsh",
        ),
        toolMarkers("gemini"),
      );
      mintsAt(LOCAL_ENDPOINT);

      await refreshTelemetryWiringForLogin(localCfg());

      const zshrc = fs.readFileSync(rcPath("zsh"), "utf8");
      expect(zshrc).toContain(LOCAL_ENDPOINT);
      expect(zshrc).not.toContain(OTHER_LOCAL_ENDPOINT);
    });
  });

  describe("when the codex gateway block routes elsewhere", () => {
    /** @scenario "A login on this machine leaves a codex gateway block that routes elsewhere" */
    it("leaves the gateway block exactly as it was", async () => {
      writeCodexGatewayBlock({ gatewayUrl: "https://gateway.elsewhere.test" });
      const before = fs.readFileSync(defaultCodexConfigPath(), "utf8");

      await refreshTelemetryWiringForLogin(localCfg());

      expect(fs.readFileSync(defaultCodexConfigPath(), "utf8")).toBe(before);
      expect(codexGatewayBlockBaseUrl()).toContain("gateway.elsewhere.test");
    });
  });

  describe("when the login left wiring alone", () => {
    /** @scenario "The login says which wiring it left alone and how to move it" */
    it("names the tool and the command that moves it", () => {
      const lines = keptWiringLines({ tools: ["claude"], reason: "loopback_login" });

      expect(lines.join("\n")).toContain("reports to another LangWatch");
      expect(lines.join("\n")).toContain("langwatch claude");
    });
  });
});
