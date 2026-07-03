/**
 * Tests for the Path B (ingestion) persist OFFER driven from the
 * `langwatch <tool>` wrapper. Two target paths are covered:
 *
 *   - `claude` writes to `~/.claude/settings.json`'s top-level `env`
 *     block (native Claude Code env loader; doesn't leak vars into
 *     unrelated shell children)
 *   - `codex` (and any other tool without an app-scoped env block)
 *     falls back to appending a marker-bracketed export block to the
 *     detected shell rc file
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

  describe("when the tool is `codex` (no app-scoped env block)", () => {
    describe("and the user answers 'y'", () => {
      it("appends the marked OTEL block to ~/.zshrc", async () => {
        answers.push("y");
        const { maybeOfferIngestionShellRcPersist } = await import(
          "../shell-rc.js"
        );
        await maybeOfferIngestionShellRcPersist({
          cfg: cfg(),
          tool: "codex",
          vars: otelVars,
        });
        const rc = fs.readFileSync(path.join(tmpHome, ".zshrc"), "utf8");
        expect(rc).toContain("# >>> langwatch begin >>>");
        expect(rc).toContain(
          "export OTEL_EXPORTER_OTLP_ENDPOINT=http://app.example.com/api/otel",
        );
        expect(rc).toContain("# <<< langwatch end <<<");
        // The Claude Code settings file must NOT be touched — codex has no
        // reason to write there.
        expect(fs.existsSync(claudeSettingsPath())).toBe(false);
      });

      it("names ~/.zshrc in the prompt", async () => {
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
        expect(lastPrompts[0]).toContain(".zshrc");
        expect(lastPrompts[0]).not.toContain("~/.claude/settings.json");
      });
    });

    describe("and the user answers 'never'", () => {
      it("persists shell_rc_preference='skip' and leaves ~/.zshrc untouched", async () => {
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
        expect(fs.existsSync(path.join(tmpHome, ".zshrc"))).toBe(false);
      });
    });

    describe("and ~/.zshrc already carries this export set", () => {
      it("stays quiet even if the current shell hasn't sourced it yet", async () => {
        const rcFile = path.join(tmpHome, ".zshrc");
        const installed = `# >>> langwatch begin >>>\n${Object.entries(otelVars)
          .map(([k, v]) => `export ${k}=${v}`)
          .join("\n")}\n# <<< langwatch end <<<\n`;
        fs.writeFileSync(rcFile, installed);
        // No answer queued: a fired prompt would read "" → "yes" → rewrite.
        const { maybeOfferIngestionShellRcPersist } = await import(
          "../shell-rc.js"
        );
        await maybeOfferIngestionShellRcPersist({
          cfg: cfg(),
          tool: "codex",
          vars: otelVars,
        });
        expect(saveConfigMock).not.toHaveBeenCalled();
        expect(fs.readFileSync(rcFile, "utf8")).toBe(installed);
      });
    });

    describe("and ~/.zshrc holds a stale block", () => {
      it("still offers and rewrites the block with the current export set", async () => {
        const rcFile = path.join(tmpHome, ".zshrc");
        fs.writeFileSync(
          rcFile,
          "# >>> langwatch begin >>>\nexport OTEL_EXPORTER_OTLP_ENDPOINT=http://old\n# <<< langwatch end <<<\n",
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
        const rc = fs.readFileSync(rcFile, "utf8");
        expect(rc).toContain("export OTEL_TRACES_EXPORTER=otlp");
        expect(rc).toContain(
          "export OTEL_EXPORTER_OTLP_ENDPOINT=http://app.example.com/api/otel",
        );
        expect(rc).toContain("OTEL_EXPORTER_OTLP_HEADERS");
        expect(rc).toContain("sk-lw-token");
        expect(rc).not.toContain("http://old");
      });
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
