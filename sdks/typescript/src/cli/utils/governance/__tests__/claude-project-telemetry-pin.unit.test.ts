/**
 * ensureClaudeProjectTelemetryPin / removeClaudeProjectTelemetryPin — the
 * claude project-level pin at $CWD/.claude/settings.local.json. Claude
 * Code applies local project settings ABOVE user-level
 * ~/.claude/settings.json, so this pin is what guarantees an
 * ingestion-mode wrapped run can't be rerouted by user-level config
 * (latest login wins, #6202); gateway-mode runs remove it instead so
 * gateway capture + a live exporter never double-trace.
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

				const exclude = fs.readFileSync(
					path.join(temp.cwd, ".git", "info", "exclude"),
					"utf8",
				);
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
			expect(written.env.OTEL_EXPORTER_OTLP_HEADERS).toBe(
				`Authorization=Bearer ${CURRENT_TOKEN}`,
			);
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
				JSON.stringify(
					{ permissions: { allow: ["Bash(git status)"] } },
					null,
					2,
				),
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
