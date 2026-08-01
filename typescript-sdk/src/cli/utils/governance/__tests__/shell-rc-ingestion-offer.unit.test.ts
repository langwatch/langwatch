/**
 * Tests for the Path B (ingestion) persist OFFER driven from the
 * `langwatch <tool>` wrapper. Two target paths are covered:
 *
 *   - `claude` writes to `~/.claude/settings.json`'s top-level `env`
 *     block (native Claude Code env loader; doesn't leak vars into
 *     unrelated shell children)
 *   - `codex` writes the Authorization header into its native `[otel]`
 *     block in `~/.codex/config.toml` (same no-leak property)
 *   - any other tool without an app-scoped target (cursor, gemini,
 *     opencode) falls back to appending a marker-bracketed export block
 *     to the detected shell rc file
 *
 * Drives the Y / n / never branches by mocking readline (the stdin
 * prompt) and saveConfig (the persistence).
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { GovernanceConfig } from "../config";
import type * as ConfigModule from "../config";

const answers: string[] = [];
const lastPrompts: string[] = [];

vi.mock("node:readline", () => ({
  createInterface: () => ({
    question: (q: string, cb: (a: string) => void) => {
      lastPrompts.push(q);
      cb(answers.shift() ?? "");
    },
    close: () => undefined,
  }),
}));

const saveConfigMock = vi.fn();
vi.mock("../config", async () => {
  const actual = await vi.importActual<typeof ConfigModule>("../config");
  return { ...actual, saveConfig: saveConfigMock };
});

let tmpHome: string;
const origHome = process.env.HOME;
const origUserprofile = process.env.USERPROFILE;
const origShell = process.env.SHELL;
const origTtyDescriptor = Object.getOwnPropertyDescriptor(
  process.stdin,
  "isTTY",
);
const origEndpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT;

const otelVars: Record<string, string> = {
  OTEL_TRACES_EXPORTER: "otlp",
  OTEL_EXPORTER_OTLP_ENDPOINT: "http://app.example.com/api/otel",
  OTEL_EXPORTER_OTLP_HEADERS: "Authorization=Bearer sk-lw-token",
};

function cfg(overrides: Partial<GovernanceConfig> = {}): GovernanceConfig {
  return {
    gateway_url: "http://gw.example.com",
    control_plane_url: "http://app.example.com",
    ...overrides,
  };
}

function claudeSettingsPath(): string {
  return path.join(tmpHome, ".claude", "settings.json");
}

beforeEach(() => {
  tmpHome = fs.mkdtempSync(path.join(os.tmpdir(), "lw-shellrc-offer-"));
  process.env.HOME = tmpHome;
  process.env.USERPROFILE = tmpHome;
  process.env.SHELL = "/bin/zsh";
  delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  Object.defineProperty(process.stdin, "isTTY", {
    value: true,
    configurable: true,
  });
  answers.length = 0;
  lastPrompts.length = 0;
  saveConfigMock.mockReset();
});

afterEach(() => {
  process.env.HOME = origHome;
  process.env.USERPROFILE = origUserprofile;
  process.env.SHELL = origShell;
  if (origEndpoint === undefined) {
    delete process.env.OTEL_EXPORTER_OTLP_ENDPOINT;
  } else {
    process.env.OTEL_EXPORTER_OTLP_ENDPOINT = origEndpoint;
  }
  if (origTtyDescriptor) {
    Object.defineProperty(process.stdin, "isTTY", origTtyDescriptor);
  }
  fs.rmSync(tmpHome, { recursive: true, force: true });
  vi.restoreAllMocks();
});

describe("maybeOfferIngestionShellRcPersist", () => {
  describe("when the tool is `claude`", () => {
    describe("and the user answers 'y'", () => {
      it("merges OTEL vars into ~/.claude/settings.json's `env` block", async () => {
        answers.push("y");
        const { maybeOfferIngestionShellRcPersist } = await import(
          "../shell-rc.js"
        );
        await maybeOfferIngestionShellRcPersist({
          cfg: cfg(),
          tool: "claude",
          vars: otelVars,
        });
        const written = JSON.parse(fs.readFileSync(claudeSettingsPath(), "utf8"));
        expect(written.env).toEqual(otelVars);
        // The zsh rc must NOT be touched — the whole point of this route is
        // to keep OTEL out of every unrelated shell child.
        expect(fs.existsSync(path.join(tmpHome, ".zshrc"))).toBe(false);
      });

      it("names ~/.claude/settings.json in the prompt, not the shell rc", async () => {
        answers.push("y");
        const { maybeOfferIngestionShellRcPersist } = await import(
          "../shell-rc.js"
        );
        await maybeOfferIngestionShellRcPersist({
          cfg: cfg(),
          tool: "claude",
          vars: otelVars,
        });
        expect(lastPrompts).toHaveLength(1);
        expect(lastPrompts[0]).toContain("~/.claude/settings.json");
        expect(lastPrompts[0]).not.toContain(".zshrc");
      });

      it("preserves other top-level keys in an existing settings.json", async () => {
        fs.mkdirSync(path.dirname(claudeSettingsPath()), { recursive: true });
        fs.writeFileSync(
          claudeSettingsPath(),
          JSON.stringify(
            {
              model: "claude-sonnet-5",
              permissions: { allow: ["Bash(git status)"] },
              env: { EXISTING_VAR: "keep-me" },
            },
            null,
            2,
          ),
        );
        answers.push("y");
        const { maybeOfferIngestionShellRcPersist } = await import(
          "../shell-rc.js"
        );
        await maybeOfferIngestionShellRcPersist({
          cfg: cfg(),
          tool: "claude",
          vars: otelVars,
        });
        const written = JSON.parse(fs.readFileSync(claudeSettingsPath(), "utf8"));
        expect(written.model).toBe("claude-sonnet-5");
        expect(written.permissions).toEqual({ allow: ["Bash(git status)"] });
        expect(written.env).toEqual({ ...otelVars, EXISTING_VAR: "keep-me" });
      });
    });

    describe("and the user answers 'never'", () => {
      it("persists shell_rc_preference='skip' and leaves settings.json untouched", async () => {
        answers.push("never");
        const { maybeOfferIngestionShellRcPersist } = await import(
          "../shell-rc.js"
        );
        const c = cfg();
        await maybeOfferIngestionShellRcPersist({
          cfg: c,
          tool: "claude",
          vars: otelVars,
        });
        expect(c.shell_rc_preference).toBe("skip");
        expect(saveConfigMock).toHaveBeenCalledTimes(1);
        expect(fs.existsSync(claudeSettingsPath())).toBe(false);
      });
    });

    describe("and the user answers 'n'", () => {
      it("persists nothing and leaves settings.json untouched", async () => {
        answers.push("n");
        const { maybeOfferIngestionShellRcPersist } = await import(
          "../shell-rc.js"
        );
        const c = cfg();
        await maybeOfferIngestionShellRcPersist({
          cfg: c,
          tool: "claude",
          vars: otelVars,
        });
        expect(c.shell_rc_preference).toBeUndefined();
        expect(saveConfigMock).not.toHaveBeenCalled();
        expect(fs.existsSync(claudeSettingsPath())).toBe(false);
      });
    });

    describe("and settings.json already carries every OTEL key", () => {
      it("does not prompt or write", async () => {
        fs.mkdirSync(path.dirname(claudeSettingsPath()), { recursive: true });
        fs.writeFileSync(
          claudeSettingsPath(),
          JSON.stringify({ env: otelVars }, null, 2),
        );
        // No answer queued: a fired prompt would read "" → "yes".
        const { maybeOfferIngestionShellRcPersist } = await import(
          "../shell-rc.js"
        );
        await maybeOfferIngestionShellRcPersist({
          cfg: cfg(),
          tool: "claude",
          vars: otelVars,
        });
        expect(lastPrompts).toHaveLength(0);
        expect(saveConfigMock).not.toHaveBeenCalled();
      });
    });

    describe("and settings.json carries stale OTEL values", () => {
      it("still offers and refreshes the env block", async () => {
        fs.mkdirSync(path.dirname(claudeSettingsPath()), { recursive: true });
        fs.writeFileSync(
          claudeSettingsPath(),
          JSON.stringify(
            {
              env: { OTEL_EXPORTER_OTLP_ENDPOINT: "http://stale.example.com" },
            },
            null,
            2,
          ),
        );
        answers.push("y");
        const { maybeOfferIngestionShellRcPersist } = await import(
          "../shell-rc.js"
        );
        await maybeOfferIngestionShellRcPersist({
          cfg: cfg(),
          tool: "claude",
          vars: otelVars,
        });
        const written = JSON.parse(fs.readFileSync(claudeSettingsPath(), "utf8"));
        expect(written.env.OTEL_EXPORTER_OTLP_ENDPOINT).toBe(
          "http://app.example.com/api/otel",
        );
        expect(written.env.OTEL_TRACES_EXPORTER).toBe("otlp");
      });
    });
  });

  describe("when the tool is `codex` (native ~/.codex/config.toml target)", () => {
    function codexConfigPath(): string {
      return path.join(tmpHome, ".codex", "config.toml");
    }

    describe("and the user answers 'y'", () => {
      it("writes the Authorization header into config.toml's [otel] block", async () => {
        answers.push("y");
        const { maybeOfferIngestionShellRcPersist } = await import(
          "../shell-rc.js"
        );
        await maybeOfferIngestionShellRcPersist({
          cfg: cfg(),
          tool: "codex",
          vars: otelVars,
        });
        const toml = fs.readFileSync(codexConfigPath(), "utf8");
        expect(toml).toContain("[otel.trace_exporter.otlp-http]");
        expect(toml).toContain(
          `headers = { "Authorization" = "Bearer sk-lw-token" }`,
        );
        // codex does not append /v1/traces itself, so the block spells it out.
        expect(toml).toContain(
          `endpoint = "http://app.example.com/api/otel/v1/traces"`,
        );
        // Neither the shell rc nor the Claude Code settings file is touched.
        expect(fs.existsSync(path.join(tmpHome, ".zshrc"))).toBe(false);
        expect(fs.existsSync(claudeSettingsPath())).toBe(false);
      });

      it("names ~/.codex/config.toml in the prompt, not the shell rc", async () => {
        answers.push("y");
        const { maybeOfferIngestionShellRcPersist } = await import(
          "../shell-rc.js"
        );
        await maybeOfferIngestionShellRcPersist({
          cfg: cfg(),
          tool: "codex",
          vars: otelVars,
        });
        expect(lastPrompts).toHaveLength(1);
        expect(lastPrompts[0]).toContain("~/.codex/config.toml");
        expect(lastPrompts[0]).not.toContain(".zshrc");
      });
    });

    describe("and the user answers 'never'", () => {
      it("persists shell_rc_preference='skip' and leaves config.toml untouched", async () => {
        answers.push("never");
        const { maybeOfferIngestionShellRcPersist } = await import(
          "../shell-rc.js"
        );
        const c = cfg();
        await maybeOfferIngestionShellRcPersist({
          cfg: c,
          tool: "codex",
          vars: otelVars,
        });
        expect(c.shell_rc_preference).toBe("skip");
        expect(saveConfigMock).toHaveBeenCalledTimes(1);
        expect(fs.existsSync(codexConfigPath())).toBe(false);
      });
    });

    describe("and config.toml already carries the Authorization header", () => {
      it("stays quiet — no prompt, no rewrite", async () => {
        const configFile = codexConfigPath();
        fs.mkdirSync(path.dirname(configFile), { recursive: true });
        const installed = [
          "# >>> langwatch otel begin >>>",
          "[otel]",
          `environment = "langwatch"`,
          "",
          "[otel.trace_exporter.otlp-http]",
          `endpoint = "http://app.example.com/api/otel/v1/traces"`,
          `protocol = "json"`,
          `headers = { "Authorization" = "Bearer sk-lw-token" }`,
          "# <<< langwatch otel end <<<",
          "",
        ].join("\n");
        fs.writeFileSync(configFile, installed);
        // No answer queued: a fired prompt would read "" → "yes" → rewrite.
        const { maybeOfferIngestionShellRcPersist } = await import(
          "../shell-rc.js"
        );
        await maybeOfferIngestionShellRcPersist({
          cfg: cfg(),
          tool: "codex",
          vars: otelVars,
        });
        expect(lastPrompts).toHaveLength(0);
        expect(saveConfigMock).not.toHaveBeenCalled();
        expect(fs.readFileSync(configFile, "utf8")).toBe(installed);
      });
    });

    describe("and config.toml has the endpoint-only block (no header yet)", () => {
      it("still offers and installs the header without doubling the block", async () => {
        const configFile = codexConfigPath();
        fs.mkdirSync(path.dirname(configFile), { recursive: true });
        // The wrapper's unconditional setup write: endpoint, no header.
        fs.writeFileSync(
          configFile,
          [
            "# >>> langwatch otel begin >>>",
            "[otel]",
            `environment = "langwatch"`,
            "",
            "[otel.trace_exporter.otlp-http]",
            `endpoint = "http://app.example.com/api/otel/v1/traces"`,
            `protocol = "json"`,
            "# <<< langwatch otel end <<<",
            "",
          ].join("\n"),
        );
        answers.push("y");
        const { maybeOfferIngestionShellRcPersist } = await import(
          "../shell-rc.js"
        );
        await maybeOfferIngestionShellRcPersist({
          cfg: cfg(),
          tool: "codex",
          vars: otelVars,
        });
        const toml = fs.readFileSync(configFile, "utf8");
        expect(toml).toContain(
          `headers = { "Authorization" = "Bearer sk-lw-token" }`,
        );
        expect((toml.match(/langwatch otel begin/g) ?? []).length).toBe(1);
      });
    });
  });

  describe("when the tool is `opencode` (scoped shell function, no global export)", () => {
    describe("and the user answers 'y'", () => {
      it("writes a scoped opencode() wrapper, not bare exports", async () => {
        answers.push("y");
        const { maybeOfferIngestionShellRcPersist } = await import(
          "../shell-rc.js"
        );
        await maybeOfferIngestionShellRcPersist({
          cfg: cfg(),
          tool: "opencode",
          vars: otelVars,
        });
        const rc = fs.readFileSync(path.join(tmpHome, ".zshrc"), "utf8");
        expect(rc).toContain("# >>> langwatch opencode begin >>>");
        expect(rc).toContain("opencode() {");
        expect(rc).toContain('command opencode "$@"');
        expect(rc).toContain(
          "OTEL_EXPORTER_OTLP_ENDPOINT=http://app.example.com/api/otel",
        );
        // NOT a bare global export — that's the leak we're avoiding.
        expect(rc).not.toContain("export OTEL_TRACES_EXPORTER");
        // Claude Code settings file untouched.
        expect(fs.existsSync(claudeSettingsPath())).toBe(false);
      });

      it("names the shell rc in the prompt", async () => {
        answers.push("y");
        const { maybeOfferIngestionShellRcPersist } = await import(
          "../shell-rc.js"
        );
        await maybeOfferIngestionShellRcPersist({
          cfg: cfg(),
          tool: "opencode",
          vars: otelVars,
        });
        expect(lastPrompts).toHaveLength(1);
        expect(lastPrompts[0]).toContain(".zshrc");
      });
    });

    describe("and ~/.zshrc already has an export block from another tool", () => {
      it("adds the opencode wrapper under its own markers, leaving the export block", async () => {
        const rcFile = path.join(tmpHome, ".zshrc");
        const priorExport =
          "# >>> langwatch begin >>>\nexport OTEL_EXPORTER_OTLP_ENDPOINT=http://gemini\n# <<< langwatch end <<<\n";
        fs.writeFileSync(rcFile, priorExport);
        answers.push("y");
        const { maybeOfferIngestionShellRcPersist } = await import(
          "../shell-rc.js"
        );
        await maybeOfferIngestionShellRcPersist({
          cfg: cfg(),
          tool: "opencode",
          vars: otelVars,
        });
        const rc = fs.readFileSync(rcFile, "utf8");
        // both blocks present, neither clobbered
        expect(rc).toContain("# >>> langwatch begin >>>");
        expect(rc).toContain("export OTEL_EXPORTER_OTLP_ENDPOINT=http://gemini");
        expect(rc).toContain("# >>> langwatch opencode begin >>>");
        expect(rc).toContain("opencode() {");
      });
    });

    describe("and the opencode wrapper already targets this endpoint", () => {
      it("stays quiet — no prompt, no rewrite", async () => {
        const rcFile = path.join(tmpHome, ".zshrc");
        const installed =
          "# >>> langwatch opencode begin >>>\nopencode() {\n    OTEL_EXPORTER_OTLP_ENDPOINT=http://app.example.com/api/otel \\\n    command opencode \"$@\"\n}\n# <<< langwatch opencode end <<<\n";
        fs.writeFileSync(rcFile, installed);
        // No answer queued: a fired prompt would read "" → "yes" → rewrite.
        const { maybeOfferIngestionShellRcPersist } = await import(
          "../shell-rc.js"
        );
        await maybeOfferIngestionShellRcPersist({
          cfg: cfg(),
          tool: "opencode",
          vars: otelVars,
        });
        expect(lastPrompts).toHaveLength(0);
        expect(saveConfigMock).not.toHaveBeenCalled();
        expect(fs.readFileSync(rcFile, "utf8")).toBe(installed);
      });
    });
  });

  describe("when the tool is `gemini` (same scoped-function pattern)", () => {
    it("writes a scoped gemini() wrapper under its own markers, no global export", async () => {
      answers.push("y");
      const { maybeOfferIngestionShellRcPersist } = await import(
        "../shell-rc.js"
      );
      await maybeOfferIngestionShellRcPersist({
        cfg: cfg(),
        tool: "gemini",
        vars: otelVars,
      });
      const rc = fs.readFileSync(path.join(tmpHome, ".zshrc"), "utf8");
      expect(rc).toContain("# >>> langwatch gemini begin >>>");
      expect(rc).toContain("gemini() {");
      expect(rc).toContain('command gemini "$@"');
      expect(rc).not.toContain("export OTEL_TRACES_EXPORTER");
    });
  });

  describe("when shell_rc_preference is 'skip' (any tool)", () => {
    it("does not prompt or write for claude", async () => {
      const { maybeOfferIngestionShellRcPersist } = await import(
        "../shell-rc.js"
      );
      await maybeOfferIngestionShellRcPersist({
        cfg: cfg({ shell_rc_preference: "skip" }),
        tool: "claude",
        vars: otelVars,
      });
      expect(lastPrompts).toHaveLength(0);
      expect(saveConfigMock).not.toHaveBeenCalled();
      expect(fs.existsSync(claudeSettingsPath())).toBe(false);
    });

    it("does not prompt or write for codex", async () => {
      const { maybeOfferIngestionShellRcPersist } = await import(
        "../shell-rc.js"
      );
      await maybeOfferIngestionShellRcPersist({
        cfg: cfg({ shell_rc_preference: "skip" }),
        tool: "codex",
        vars: otelVars,
      });
      expect(lastPrompts).toHaveLength(0);
      expect(saveConfigMock).not.toHaveBeenCalled();
      expect(fs.existsSync(path.join(tmpHome, ".zshrc"))).toBe(false);
    });
  });
});
