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

	describe("when a pin from a pre-#8284 CLI still carries OTEL_LOG_RAW_API_BODIES", () => {
		it("strips the legacy flag and adds the replacement in one migration", () => {
			// The old wiring set RAW_API_BODIES and did not know
			// OTEL_LOG_ASSISTANT_RESPONSES; the pin must migrate on re-sync.
			const { OTEL_LOG_ASSISTANT_RESPONSES: _new, ...preMigration } =
				currentClaudeVars();
			const target = claudeProjectSettingsTarget(temp.cwd);
			installAppEnv(target, {
				...preMigration,
				OTEL_LOG_RAW_API_BODIES: "1",
			});

			const result = ensureClaudeProjectTelemetryPin({
				vars: currentClaudeVars(),
				cwd: temp.cwd,
			});

			expect(result.action).toBe("updated");
			const written = JSON.parse(fs.readFileSync(target.path, "utf8"));
			expect(written.env.OTEL_LOG_RAW_API_BODIES).toBeUndefined();
			expect(written.env.OTEL_LOG_ASSISTANT_RESPONSES).toBe("1");
		});
	});

	describe("when a migrated pin carries a deliberate OTEL_LOG_RAW_API_BODIES opt-in", () => {
		/** @scenario "A raw-body opt-in added after the upgrade survives every refresh" */
		it("preserves the opt-in on re-sync instead of stripping it again", () => {
			// The pin already has OTEL_LOG_ASSISTANT_RESPONSES (migrated) and the
			// user then added RAW_API_BODIES back for debugging. The strip is a
			// one-time migration keyed on the absence of the new flag, so it must
			// not fire here (#8284 review P2).
			const target = claudeProjectSettingsTarget(temp.cwd);
			installAppEnv(target, {
				...currentClaudeVars(),
				OTEL_LOG_RAW_API_BODIES: "1",
			});

			const result = ensureClaudeProjectTelemetryPin({
				vars: currentClaudeVars(),
				cwd: temp.cwd,
			});

			expect(result.action).toBe("unchanged");
			const written = JSON.parse(fs.readFileSync(target.path, "utf8"));
			expect(written.env.OTEL_LOG_RAW_API_BODIES).toBe("1");
		});
	});

	describe("when a project file has only a hand-set OTEL_LOG_RAW_API_BODIES and no langwatch key yet", () => {
		/** @scenario "A raw-body-only project setting is not stripped before the pin has ever been ours" */
		it("preserves it while installing the pin alongside it", () => {
			// hasOwnedKey is false here: the file carries none of our current
			// keys, only a flag the user set by hand. It has never been a
			// langwatch pin, so its RAW_API_BODIES is not "the old default"
			// left by a pre-#8284 CLI - there is no history to migrate. The
			// !hasOwnedKey branch of isLangwatchAuthored exists to allow
			// WRITING such a file, not to license stripping a flag we never
			// wrote (CodeRabbit finding on #8286).
			const target = claudeProjectSettingsTarget(temp.cwd);
			fs.mkdirSync(path.dirname(target.path), { recursive: true });
			fs.writeFileSync(
				target.path,
				JSON.stringify({ env: { OTEL_LOG_RAW_API_BODIES: "1" } }, null, 2),
			);

			const result = ensureClaudeProjectTelemetryPin({
				vars: currentClaudeVars(),
				cwd: temp.cwd,
			});

			expect(result.action).toBe("updated");
			const written = JSON.parse(fs.readFileSync(target.path, "utf8"));
			expect(written.env.OTEL_LOG_RAW_API_BODIES).toBe("1");
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
