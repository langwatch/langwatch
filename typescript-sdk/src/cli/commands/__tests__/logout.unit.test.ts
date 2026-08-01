/**
 * `langwatch logout` orchestration: scan → (confirm) → remove telemetry
 * wiring, and revoke the session unless --keep-credentials. Exercised
 * against a real temp HOME + isolated config path with --yes so no prompt
 * blocks and --keep-credentials so no network revoke is attempted.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { appSettingsTargetFor, installAppEnv } from "@/cli/utils/governance/app-settings";
import {
  buildScopedToolFunction,
  persistBlockToRc,
  rcPath,
  toolMarkers,
} from "@/cli/utils/governance/shell-rc";
import { logoutCommand } from "../logout";

let tmpHome: string;
const origHome = process.env.HOME;
const origUserprofile = process.env.USERPROFILE;
const origCodexHome = process.env.CODEX_HOME;
const origCliConfig = process.env.LANGWATCH_CLI_CONFIG;

const seedClaudeAndGemini = (): void => {
  installAppEnv(appSettingsTargetFor("claude")!, {
    OTEL_EXPORTER_OTLP_ENDPOINT: "http://app/api/otel",
    CLAUDE_CODE_ENABLE_TELEMETRY: "1",
  });
  persistBlockToRc(
    "zsh",
    buildScopedToolFunction(
      "gemini",
      { OTEL_EXPORTER_OTLP_ENDPOINT: "http://app/api/otel" },
      "zsh",
    ),
    toolMarkers("gemini"),
  );
};

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "lw-logout-"));
  process.env.HOME = tmpHome;
  process.env.USERPROFILE = tmpHome;
  delete process.env.CODEX_HOME;
  process.env.LANGWATCH_CLI_CONFIG = path.join(tmpHome, "config.json");
  vi.spyOn(console, "log").mockImplementation(() => undefined);
  vi.spyOn(console, "error").mockImplementation(() => undefined);
});

afterEach(() => {
  process.env.HOME = origHome;
  process.env.USERPROFILE = origUserprofile;
  if (origCodexHome === undefined) delete process.env.CODEX_HOME;
  else process.env.CODEX_HOME = origCodexHome;
  if (origCliConfig === undefined) delete process.env.LANGWATCH_CLI_CONFIG;
  else process.env.LANGWATCH_CLI_CONFIG = origCliConfig;
  vi.restoreAllMocks();
  fs.rmSync(tmpHome, { recursive: true, force: true });
});

describe("logoutCommand", () => {
  describe("when telemetry wiring is present", () => {
    it("removes every present target with --yes --keep-credentials", async () => {
      seedClaudeAndGemini();

      await logoutCommand({ yes: true, keepCredentials: true });

      const claudePath = appSettingsTargetFor("claude")!.path;
      const claude = JSON.parse(fs.readFileSync(claudePath, "utf8"));
      expect("env" in claude).toBe(false);
      const rc = fs.readFileSync(rcPath("zsh"), "utf8");
      expect(rc).not.toContain("langwatch gemini begin");
    });
  });

  describe("when --keep-credentials is passed", () => {
    it("leaves a logged-in session file on disk", async () => {
      seedClaudeAndGemini();
      const cfgPath = process.env.LANGWATCH_CLI_CONFIG!;
      fs.writeFileSync(
        cfgPath,
        JSON.stringify({ access_token: "at", refresh_token: "rt" }, null, 2),
      );

      await logoutCommand({ yes: true, keepCredentials: true });

      // wiring gone, but the session is untouched (no revoke)
      expect(fs.existsSync(cfgPath)).toBe(true);
      const cfg = JSON.parse(fs.readFileSync(cfgPath, "utf8"));
      expect(cfg.access_token).toBe("at");
      const rc = fs.readFileSync(rcPath("zsh"), "utf8");
      expect(rc).not.toContain("langwatch gemini begin");
    });
  });

  describe("when nothing is installed and not logged in", () => {
    it("reports there is nothing to clean up", async () => {
      const logSpy = vi.spyOn(console, "log");

      await logoutCommand({ yes: true });

      const printed = logSpy.mock.calls.map((c) => String(c[0])).join("\n");
      expect(printed).toContain("Nothing to clean up");
    });
  });
});
