/**
 * The claude project-level pin at $CWD/.claude/settings.local.json, which
 * Claude Code applies ABOVE user-level settings -- guarantees an ingestion
 * run can't be rerouted. Gateway-mode runs remove it to avoid double-tracing.
 */
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";

import { describe, expect, it } from "vitest";

import { claudeProjectSettingsTarget, installAppEnv } from "../app-settings";
import { buildOtelEnvBlock } from "../otel-env-block";
import {
  ensureClaudeProjectTelemetryPin,
  removeClaudeProjectTelemetryPin,
} from "../telemetry-refresh";
import {
  CURRENT_ENDPOINT,
  CURRENT_TOKEN,
  currentClaudeVars,
  installTempHomeAndCwd,
  STALE_ENDPOINT,
  STALE_TOKEN,
} from "./telemetry-refresh-test-helpers";

const temp = installTempHomeAndCwd();

describe("ensureClaudeProjectTelemetryPin", () => {
  describe("when no pin exists in the working directory", () => {
    it("creates .claude/settings.local.json with the run's env", () => {
      const result = ensureClaudeProjectTelemetryPin({
        vars: currentClaudeVars(),
        cwd: temp.cwd,
      });

      expect(result.action).toBe("created");
      const written = JSON.parse(fs.readFileSync(result.path, "utf8"));
      expect(written.env.OTEL_EXPORTER_OTLP_ENDPOINT).toBe(CURRENT_ENDPOINT);
      expect(written.env.CLAUDE_CODE_ENABLE_TELEMETRY).toBe("1");
    });

    describe("and the directory is a git repository", () => {
      it("adds the pin to .git/info/exclude so the ingest key can't be committed", () => {
        execFileSync("git", ["init", "-q"], { cwd: temp.cwd });

        ensureClaudeProjectTelemetryPin({
          vars: currentClaudeVars(),
          cwd: temp.cwd,
        });

        const exclude = fs.readFileSync(path.join(temp.cwd, ".git", "info", "exclude"), "utf8");
        expect(exclude).toContain("**/.claude/settings.local.json");
      });
    });

    describe("and the directory is not a git repository", () => {
      it("still creates the pin without erroring", () => {
        const result = ensureClaudeProjectTelemetryPin({
          vars: currentClaudeVars(),
          cwd: temp.cwd,
        });
        expect(result.action).toBe("created");
      });
    });
  });

  describe("when the directory is a git repository", () => {
    const pinPath = () => path.join(temp.cwd, ".claude", "settings.local.json");
    const excludePath = () => path.join(temp.cwd, ".git", "info", "exclude");
    const git = (...args: string[]) => execFileSync("git", args, { cwd: temp.cwd });

    describe("and the pin file already existed, unignored", () => {
      /** @scenario "a pin in a file that already existed is still kept out of git" */
      it("adds the exclude entry anyway", () => {
        git("init", "-q");
        fs.mkdirSync(path.dirname(pinPath()), { recursive: true });
        fs.writeFileSync(pinPath(), "{}\n");

        const result = ensureClaudeProjectTelemetryPin({
          vars: currentClaudeVars(),
          cwd: temp.cwd,
        });

        expect(result.action).toBe("updated");
        expect(fs.readFileSync(excludePath(), "utf8")).toContain("**/.claude/settings.local.json");
        expect(git("status", "--porcelain").toString()).toBe("");
      });
    });

    describe("and .gitignore already covers the pin file", () => {
      /** @scenario "a pin file git already ignores is not excluded twice" */
      it("leaves the exclude file as it was", () => {
        git("init", "-q");
        fs.writeFileSync(path.join(temp.cwd, ".gitignore"), ".claude/settings.local.json\n");
        const before = fs.readFileSync(excludePath(), "utf8");

        ensureClaudeProjectTelemetryPin({ vars: currentClaudeVars(), cwd: temp.cwd });

        expect(fs.readFileSync(excludePath(), "utf8")).toBe(before);
      });
    });

    describe("and git tracks a pin file an older run wrote a key into", () => {
      /** @scenario "a key an older run left in a tracked pin file is taken out" */
      it("removes the langwatch env and keeps the user's own settings", () => {
        git("init", "-q");
        installAppEnv(
          claudeProjectSettingsTarget(temp.cwd),
          buildOtelEnvBlock("claude", STALE_ENDPOINT, STALE_TOKEN),
        );
        const withUserKey = JSON.parse(fs.readFileSync(pinPath(), "utf8"));
        fs.writeFileSync(pinPath(), JSON.stringify({ ...withUserKey, model: "opus" }));
        git("add", "-f", ".claude/settings.local.json");

        const result = ensureClaudeProjectTelemetryPin({
          vars: currentClaudeVars(),
          cwd: temp.cwd,
        });

        const after = fs.readFileSync(pinPath(), "utf8");
        expect(result.action).toBe("tracked");
        expect(after).not.toContain(STALE_TOKEN);
        expect(after).not.toContain(CURRENT_TOKEN);
        expect(JSON.parse(after).model).toBe("opus");
      });
    });

    describe("and git does not answer in time", () => {
      /** @scenario "no key is written when git cannot say whether it tracks the pin file" */
      it("writes nothing and reports the pin as unverified", () => {
        const bin = fs.mkdtempSync(path.join(temp.cwd, "slow-git-"));
        fs.writeFileSync(path.join(bin, "git"), "#!/bin/sh\nsleep 5\n", { mode: 0o755 });
        const prevPath = process.env.PATH;
        process.env.PATH = `${bin}${path.delimiter}${prevPath}`;
        try {
          const result = ensureClaudeProjectTelemetryPin({
            vars: currentClaudeVars(),
            cwd: temp.cwd,
          });

          expect(result.action).toBe("unverified");
          expect(fs.existsSync(pinPath())).toBe(false);
        } finally {
          process.env.PATH = prevPath;
        }
      });
    });

    describe("and git fails reading its index", () => {
      /** @scenario "a git error is not taken as an untracked pin file" */
      it("writes no key and takes out the previous login's env", () => {
        git("init", "-q");
        installAppEnv(
          claudeProjectSettingsTarget(temp.cwd),
          buildOtelEnvBlock("claude", STALE_ENDPOINT, STALE_TOKEN),
        );
        git("add", "-f", ".claude/settings.local.json");
        fs.writeFileSync(path.join(temp.cwd, ".git", "index"), "not an index");

        const result = ensureClaudeProjectTelemetryPin({
          vars: currentClaudeVars(),
          cwd: temp.cwd,
        });

        const after = fs.readFileSync(pinPath(), "utf8");
        expect(result.action).toBe("unverified");
        expect(after).not.toContain(CURRENT_TOKEN);
        expect(after).not.toContain(STALE_TOKEN);
      });
    });

    describe("and git tracks the pin file", () => {
      /** @scenario "no key is written into a pin file git tracks" */
      it("writes no key into it and reports it as tracked", () => {
        git("init", "-q");
        fs.mkdirSync(path.dirname(pinPath()), { recursive: true });
        fs.writeFileSync(pinPath(), '{ "permissions": {} }\n');
        git("add", "-f", ".claude/settings.local.json");
        const before = fs.readFileSync(pinPath(), "utf8");

        const result = ensureClaudeProjectTelemetryPin({
          vars: currentClaudeVars(),
          cwd: temp.cwd,
        });

        expect(result.action).toBe("tracked");
        expect(fs.readFileSync(pinPath(), "utf8")).toBe(before);
        expect(fs.readFileSync(pinPath(), "utf8")).not.toContain(CURRENT_TOKEN);
      });
    });
  });

  describe("when a pin from a previous login exists", () => {
    it("refreshes it to the current login's values", () => {
      installAppEnv(
        claudeProjectSettingsTarget(temp.cwd),
        buildOtelEnvBlock("claude", STALE_ENDPOINT, STALE_TOKEN),
      );

      const result = ensureClaudeProjectTelemetryPin({
        vars: currentClaudeVars(),
        cwd: temp.cwd,
      });

      expect(result.action).toBe("updated");
      const written = JSON.parse(fs.readFileSync(result.path, "utf8"));
      expect(written.env.OTEL_EXPORTER_OTLP_ENDPOINT).toBe(CURRENT_ENDPOINT);
      expect(written.env.OTEL_EXPORTER_OTLP_HEADERS).toBe(`Authorization=Bearer ${CURRENT_TOKEN}`);
    });
  });

  describe("when the pin already matches the current login", () => {
    it("reports unchanged and does not rewrite the file", () => {
      const target = claudeProjectSettingsTarget(temp.cwd);
      installAppEnv(target, currentClaudeVars());
      const before = fs.statSync(target.path).mtimeMs;

      const result = ensureClaudeProjectTelemetryPin({
        vars: currentClaudeVars(),
        cwd: temp.cwd,
      });

      expect(result.action).toBe("unchanged");
      expect(fs.statSync(target.path).mtimeMs).toBe(before);
    });
  });

  describe("when the project file carries the user's own OTLP wiring", () => {
    it("skips and leaves the file byte-for-byte unchanged", () => {
      const target = claudeProjectSettingsTarget(temp.cwd);
      installAppEnv(target, {
        OTEL_EXPORTER_OTLP_ENDPOINT: "https://api.honeycomb.io",
        OTEL_EXPORTER_OTLP_HEADERS: "x-honeycomb-team=abc",
      });
      const before = fs.readFileSync(target.path, "utf8");

      const result = ensureClaudeProjectTelemetryPin({
        vars: currentClaudeVars(),
        cwd: temp.cwd,
      });

      expect(result.action).toBe("skipped");
      expect(fs.readFileSync(target.path, "utf8")).toBe(before);
    });
  });

  describe("when the project file has unrelated user content", () => {
    it("merges the pin in and preserves the user's keys", () => {
      const target = claudeProjectSettingsTarget(temp.cwd);
      fs.mkdirSync(path.dirname(target.path), { recursive: true });
      fs.writeFileSync(
        target.path,
        JSON.stringify({ permissions: { allow: ["Bash(git status)"] } }, null, 2),
      );

      ensureClaudeProjectTelemetryPin({
        vars: currentClaudeVars(),
        cwd: temp.cwd,
      });

      const written = JSON.parse(fs.readFileSync(target.path, "utf8"));
      expect(written.permissions).toEqual({ allow: ["Bash(git status)"] });
      expect(written.env.OTEL_EXPORTER_OTLP_ENDPOINT).toBe(CURRENT_ENDPOINT);
    });
  });
});

describe("removeClaudeProjectTelemetryPin", () => {
  describe("when the pin holds only langwatch keys", () => {
    it("removes the file and the empty .claude directory", () => {
      const target = claudeProjectSettingsTarget(temp.cwd);
      installAppEnv(target, currentClaudeVars());

      expect(removeClaudeProjectTelemetryPin({ cwd: temp.cwd })).toBe(true);
      expect(fs.existsSync(target.path)).toBe(false);
      expect(fs.existsSync(path.dirname(target.path))).toBe(false);
    });
  });

  describe("when the pin coexists with user content", () => {
    it("strips only the langwatch keys and keeps the file", () => {
      const target = claudeProjectSettingsTarget(temp.cwd);
      fs.mkdirSync(path.dirname(target.path), { recursive: true });
      fs.writeFileSync(
        target.path,
        JSON.stringify(
          {
            env: { ...currentClaudeVars(), MY_OWN: "keep" },
            permissions: { allow: ["Bash(git status)"] },
          },
          null,
          2,
        ),
      );

      expect(removeClaudeProjectTelemetryPin({ cwd: temp.cwd })).toBe(true);
      const after = JSON.parse(fs.readFileSync(target.path, "utf8"));
      expect(after.env).toEqual({ MY_OWN: "keep" });
      expect(after.permissions).toEqual({ allow: ["Bash(git status)"] });
    });
  });

  describe("when the file carries only the user's own OTLP wiring", () => {
    it("returns false and leaves it unchanged", () => {
      const target = claudeProjectSettingsTarget(temp.cwd);
      installAppEnv(target, {
        OTEL_EXPORTER_OTLP_ENDPOINT: "https://api.honeycomb.io",
      });
      const before = fs.readFileSync(target.path, "utf8");

      expect(removeClaudeProjectTelemetryPin({ cwd: temp.cwd })).toBe(false);
      expect(fs.readFileSync(target.path, "utf8")).toBe(before);
    });
  });

  describe("when no pin exists", () => {
    it("returns false (idempotent)", () => {
      expect(removeClaudeProjectTelemetryPin({ cwd: temp.cwd })).toBe(false);
    });
  });
});
