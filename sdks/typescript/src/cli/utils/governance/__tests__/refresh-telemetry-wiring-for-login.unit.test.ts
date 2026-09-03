/**
 * refreshTelemetryWiringForLogin — the login-time half of latest-login-wins
 * (#6202). Walks every tool's persisted wiring and re-points any
 * langwatch-authored block whose endpoint differs from the login that just
 * completed, minting (or reusing) a live ingest key on the new instance.
 */
import * as fs from "node:fs";
import * as path from "node:path";

import { beforeEach, describe, expect, it, vi } from "vitest";

import { codexOtelBlockEndpoint, writeCodexOtelBlock } from "../../codex-config-toml";
import { appSettingsTargetFor, installAppEnv } from "../app-settings";
import * as cliApi from "../cli-api";
import { buildOtelEnvBlock } from "../otel-env-block";
import { buildScopedToolFunction, persistBlockToRc, rcPath, toolMarkers } from "../shell-rc";
import { refreshTelemetryWiringForLogin } from "../telemetry-refresh";
import {
  baseCfg,
  CURRENT_ENDPOINT,
  CURRENT_TOKEN,
  currentClaudeVars,
  installTempHomeAndCwd,
  STALE_ENDPOINT,
  STALE_TOKEN,
} from "./telemetry-refresh-test-helpers";

vi.mock("../cli-api", async () => {
  const actual = await vi.importActual<typeof cliApi>("../cli-api");
  return {
    ...actual,
    mintIngestionKey: vi.fn(),
    listIngestionKeys: vi.fn(),
  };
});

const temp = installTempHomeAndCwd();

describe("refreshTelemetryWiringForLogin", () => {
  describe("given persisted wiring pointing at a previous instance", () => {
    beforeEach(() => {
      // claude → user-level settings env at the stale instance
      installAppEnv(
        appSettingsTargetFor("claude")!,
        buildOtelEnvBlock("claude", STALE_ENDPOINT, STALE_TOKEN),
      );
      // codex → [otel] marker block at the stale instance
      writeCodexOtelBlock(
        {
          baseEndpoint: STALE_ENDPOINT,
          ingestionToken: STALE_TOKEN,
        },
        { persistAuthHeader: true },
      );
      // gemini → scoped zsh function at the stale instance
      persistBlockToRc(
        "zsh",
        buildScopedToolFunction(
          "gemini",
          buildOtelEnvBlock("gemini", STALE_ENDPOINT, STALE_TOKEN),
          "zsh",
        ),
        toolMarkers("gemini"),
      );

      (cliApi.listIngestionKeys as ReturnType<typeof vi.fn>).mockResolvedValue([]);
      // vi.mocked keeps mintIngestionKey's real (async) signature, so the
      // Promise-returning implementation typechecks and lints cleanly.
      vi.mocked(cliApi.mintIngestionKey).mockImplementation(async (_cfg, sourceType) => ({
        token: `ik-lw-${sourceType.slice(0, 4)}000000000000_minted`,
        prefix: `ik-lw-${sourceType.slice(0, 4)}`,
        endpoint: CURRENT_ENDPOINT,
      }));
    });

    describe("when the user logs into a different instance", () => {
      it("re-points every langwatch-authored block at the new instance", async () => {
        const cfg = baseCfg();
        const result = await refreshTelemetryWiringForLogin(cfg);

        expect(result.labels.length).toBeGreaterThanOrEqual(3);

        const claudeEnv = JSON.parse(
          fs.readFileSync(appSettingsTargetFor("claude")!.path, "utf8"),
        ).env;
        expect(claudeEnv.OTEL_EXPORTER_OTLP_ENDPOINT).toBe(CURRENT_ENDPOINT);
        expect(claudeEnv.OTEL_EXPORTER_OTLP_HEADERS).not.toContain(STALE_TOKEN);

        expect(codexOtelBlockEndpoint()).toBe(`${CURRENT_ENDPOINT}/v1/traces`);
        const codexToml = fs.readFileSync(path.join(temp.home, ".codex", "config.toml"), "utf8");
        expect(codexToml).not.toContain(STALE_TOKEN);
        // The refresh heals the harvest wiring beside the exporters: a
        // device whose block predates the notify seam gains it here.
        expect(codexToml).toContain("langwatch codex notify begin");

        const zshrc = fs.readFileSync(rcPath("zsh"), "utf8");
        expect(zshrc).toContain(CURRENT_ENDPOINT);
        expect(zshrc).not.toContain(STALE_ENDPOINT);
      });

      it("mints one key per stale tool and stores them on the config", async () => {
        const cfg = baseCfg();
        const result = await refreshTelemetryWiringForLogin(cfg);

        expect(result.mintedAny).toBe(true);
        const minted = (cliApi.mintIngestionKey as ReturnType<typeof vi.fn>).mock.calls.map(
          (c: unknown[]) => c[1],
        );
        expect(minted).toEqual(expect.arrayContaining(["claude_code", "codex", "gemini"]));
        expect(minted).not.toContain("opencode");
        expect(cfg.default_personal_ingest_keys?.claude_code?.secret).toContain("minted");
      });

      it("keeps the persisted codex Authorization header, rotated to the new key", async () => {
        await refreshTelemetryWiringForLogin(baseCfg());
        const codexToml = fs.readFileSync(path.join(temp.home, ".codex", "config.toml"), "utf8");
        expect(codexToml).toMatch(/headers = .*Bearer ik-lw-code/);
      });
    });

    describe("when a tool is pinned to a project", () => {
      /** @scenario "A project-pinned tool is not re-pointed by a new login" */
      it("leaves that tool's wiring alone and re-points the rest", async () => {
        const cfg = baseCfg({
          tool_project_keys: { codex: { secret: "sk-lw-project-pin" } },
        });

        const result = await refreshTelemetryWiringForLogin(cfg);

        // codex keeps its wiring: the pin is deliberate scope, not stale
        // personal wiring, so the stale endpoint stays and no codex key
        // is minted.
        expect(codexOtelBlockEndpoint()).toBe(`${STALE_ENDPOINT}/v1/traces`);
        expect(vi.mocked(cliApi.mintIngestionKey).mock.calls.map((c) => c[1])).not.toContain(
          "codex",
        );
        // The unpinned tools are still refreshed.
        expect(result.labels.some((l) => l.includes("claude"))).toBe(true);
        expect(result.labels.some((l) => l.includes("gemini"))).toBe(true);
        expect(result.labels.some((l) => l.includes("codex"))).toBe(false);
      });
    });

    describe("when the org policy forbids direct OTLP for a tool", () => {
      it("leaves that tool's wiring alone and mints nothing for it", async () => {
        const cfg = baseCfg({
          tool_policies: {
            claude: { allowVk: true, allowOtelDirect: false },
          },
        });

        await refreshTelemetryWiringForLogin(cfg);

        const claudeEnv = JSON.parse(
          fs.readFileSync(appSettingsTargetFor("claude")!.path, "utf8"),
        ).env;
        expect(claudeEnv.OTEL_EXPORTER_OTLP_ENDPOINT).toBe(STALE_ENDPOINT);
        const minted = (cliApi.mintIngestionKey as ReturnType<typeof vi.fn>).mock.calls.map(
          (c: unknown[]) => c[1],
        );
        expect(minted).not.toContain("claude_code");
      });
    });

    describe("when the mint fails for one tool", () => {
      it("skips that tool and still refreshes the others", async () => {
        vi.mocked(cliApi.mintIngestionKey).mockImplementation(async (_cfg, sourceType) => {
          if (sourceType === "claude_code") {
            throw new Error("no personal workspace yet");
          }
          return {
            token: `ik-lw-${sourceType.slice(0, 4)}000000000000_minted`,
            prefix: `ik-lw-${sourceType.slice(0, 4)}`,
            endpoint: CURRENT_ENDPOINT,
          };
        });

        const result = await refreshTelemetryWiringForLogin(baseCfg());

        const claudeEnv = JSON.parse(
          fs.readFileSync(appSettingsTargetFor("claude")!.path, "utf8"),
        ).env;
        expect(claudeEnv.OTEL_EXPORTER_OTLP_ENDPOINT).toBe(STALE_ENDPOINT);
        expect(codexOtelBlockEndpoint()).toBe(`${CURRENT_ENDPOINT}/v1/traces`);
        expect(result.labels.some((l) => l.includes("codex"))).toBe(true);
      });
    });
  });

  describe("given a cached ingest key minted on a previous instance (#6202 regression)", () => {
    describe("when listIngestionKeys rejects during the login-time refresh", () => {
      it("mints a fresh key rather than reusing the cached one on the new endpoint", async () => {
        // A cache-liveness check that can't reach the server must NEVER
        // fall back to reusing this secret here: it was minted on the
        // OLD instance, and pairing it with the NEW endpoint would
        // silently corrupt working wiring into a broken combination
        // (new endpoint, token that was never valid there) -
        // reintroducing the exact hijack this PR fixes. The per-run
        // wrapper path (resolveWrapperMode) intentionally keeps the
        // opposite, offline-first behavior for a disconnected device
        // that already has a working key for ITS current instance;
        // only this login-refresh caller must refuse the fallback.
        const cfg = baseCfg({
          default_personal_ingest_keys: {
            claude_code: { secret: STALE_TOKEN, prefix: "ik-lw-stal" },
          },
        });
        installAppEnv(
          appSettingsTargetFor("claude")!,
          buildOtelEnvBlock("claude", STALE_ENDPOINT, STALE_TOKEN),
        );

        vi.mocked(cliApi.listIngestionKeys).mockRejectedValue(new Error("network unreachable"));
        vi.mocked(cliApi.mintIngestionKey).mockResolvedValue({
          token: CURRENT_TOKEN,
          prefix: "ik-lw-newl",
          endpoint: CURRENT_ENDPOINT,
        });

        await refreshTelemetryWiringForLogin(cfg);

        expect(cliApi.mintIngestionKey).toHaveBeenCalledWith(expect.any(Object), "claude_code");
        const claudeEnv = JSON.parse(
          fs.readFileSync(appSettingsTargetFor("claude")!.path, "utf8"),
        ).env;
        expect(claudeEnv.OTEL_EXPORTER_OTLP_HEADERS).toContain(CURRENT_TOKEN);
        expect(claudeEnv.OTEL_EXPORTER_OTLP_HEADERS).not.toContain(STALE_TOKEN);
      });
    });
  });

  describe("given wiring already pointing at the login's instance", () => {
    it("neither mints nor rewrites anything", async () => {
      const target = appSettingsTargetFor("claude")!;
      installAppEnv(target, currentClaudeVars());
      const before = fs.readFileSync(target.path, "utf8");

      const result = await refreshTelemetryWiringForLogin(baseCfg());

      expect(result.labels).toEqual([]);
      expect(result.mintedAny).toBe(false);
      expect(cliApi.mintIngestionKey).not.toHaveBeenCalled();
      expect(cliApi.listIngestionKeys).not.toHaveBeenCalled();
      expect(fs.readFileSync(target.path, "utf8")).toBe(before);
    });
  });

  describe("given no persisted wiring at all", () => {
    it("does nothing and never talks to the control plane", async () => {
      const result = await refreshTelemetryWiringForLogin(baseCfg());

      expect(result.labels).toEqual([]);
      expect(cliApi.mintIngestionKey).not.toHaveBeenCalled();
      expect(cliApi.listIngestionKeys).not.toHaveBeenCalled();
    });
  });

  describe("given the user's own OTLP wiring in claude settings", () => {
    it("never touches a non-langwatch-shaped block", async () => {
      const target = appSettingsTargetFor("claude")!;
      installAppEnv(target, {
        OTEL_EXPORTER_OTLP_ENDPOINT: "https://api.honeycomb.io",
        OTEL_EXPORTER_OTLP_HEADERS: "x-honeycomb-team=abc",
      });
      const before = fs.readFileSync(target.path, "utf8");

      const result = await refreshTelemetryWiringForLogin(baseCfg());

      expect(result.labels).toEqual([]);
      expect(fs.readFileSync(target.path, "utf8")).toBe(before);
    });
  });
});
