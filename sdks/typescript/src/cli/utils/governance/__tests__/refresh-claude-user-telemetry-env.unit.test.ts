/**
 * refreshClaudeUserTelemetryEnv — re-syncs the langwatch-authored env block
 * in ~/.claude/settings.json to the current run's endpoint + key (latest
 * login wins, #6202). Only touches a block that's already present AND
 * langwatch-shaped; a user's own OTLP wiring under the same key names is
 * left alone.
 */
import * as fs from "node:fs";
import * as path from "node:path";

import { beforeEach, describe, expect, it } from "vitest";

import { appSettingsTargetFor, installAppEnv } from "../app-settings";
import { buildOtelEnvBlock } from "../otel-env-block";
import { installSessionContextHooks } from "../session-context-hooks";
import { refreshClaudeUserTelemetryEnv } from "../telemetry-refresh";
import {
	CURRENT_ENDPOINT,
	CURRENT_TOKEN,
	currentClaudeVars,
	installTempHomeAndCwd,
	STALE_ENDPOINT,
	STALE_TOKEN,
} from "./telemetry-refresh-test-helpers";

const home = installTempHomeAndCwd();

describe("refreshClaudeUserTelemetryEnv", () => {
	describe("given a stale langwatch block in ~/.claude/settings.json", () => {
		beforeEach(() => {
			installAppEnv(appSettingsTargetFor("claude")!, {
				...buildOtelEnvBlock("claude", STALE_ENDPOINT, STALE_TOKEN),
			});
		});

		describe("when refreshed with the current run's values", () => {
			it("rewrites the block in place to the current endpoint and key", () => {
				const label = refreshClaudeUserTelemetryEnv({
					vars: currentClaudeVars(),
				});

				expect(label).toContain("~/.claude/settings.json");
				const written = JSON.parse(
					fs.readFileSync(appSettingsTargetFor("claude")!.path, "utf8"),
				);
				expect(written.env.OTEL_EXPORTER_OTLP_ENDPOINT).toBe(CURRENT_ENDPOINT);
				expect(written.env.OTEL_EXPORTER_OTLP_HEADERS).toBe(
					`Authorization=Bearer ${CURRENT_TOKEN}`,
				);
			});

			it("preserves user-authored settings around the block verbatim", () => {
				const target = appSettingsTargetFor("claude")!;
				const settings = JSON.parse(fs.readFileSync(target.path, "utf8"));
				settings.env.MY_OWN = "keep";
				settings.model = "claude-sonnet-5";
				fs.writeFileSync(target.path, JSON.stringify(settings, null, 2));

				refreshClaudeUserTelemetryEnv({ vars: currentClaudeVars() });

				const after = JSON.parse(fs.readFileSync(target.path, "utf8"));
				expect(after.env.MY_OWN).toBe("keep");
				expect(after.model).toBe("claude-sonnet-5");
			});
		});
	});

	describe("given the block already matches the current values", () => {
		it("returns null and leaves the env exactly as it was", () => {
			const target = appSettingsTargetFor("claude")!;
			installAppEnv(target, currentClaudeVars());
			const before = JSON.parse(fs.readFileSync(target.path, "utf8"));

			expect(refreshClaudeUserTelemetryEnv({ vars: currentClaudeVars() })).toBe(
				null,
			);

			const after = JSON.parse(fs.readFileSync(target.path, "utf8"));
			expect(after.env).toEqual(before.env);
		});

		/** @scenario "A device whose exports are already current still gets the hooks" */
		it("installs the session hooks, which a device that persisted earlier lacks", () => {
			const target = appSettingsTargetFor("claude")!;
			installAppEnv(target, currentClaudeVars());

			refreshClaudeUserTelemetryEnv({ vars: currentClaudeVars() });

			const after = JSON.parse(fs.readFileSync(target.path, "utf8"));
			expect(Object.keys(after.hooks)).toEqual(["SessionStart", "Stop"]);
		});
	});

	describe("given the device carries the LangWatch Claude Code plugin", () => {
		beforeEach(() => {
			const installedPlugins = path.join(
				home.home,
				".claude",
				"plugins",
				"installed_plugins.json",
			);
			fs.mkdirSync(path.dirname(installedPlugins), { recursive: true });
			fs.writeFileSync(
				installedPlugins,
				JSON.stringify({
					version: 2,
					plugins: { "langwatch@langwatch": [{ scope: "user" }] },
				}),
			);
		});

		/** @scenario "A login refresh does not put the raw hook entries back on a plugin device" */
		it("removes the raw hook entries the plugin replaced instead of asserting them", () => {
			const target = appSettingsTargetFor("claude")!;
			installAppEnv(target, currentClaudeVars());
			installSessionContextHooks({ tool: "claude_code" });

			refreshClaudeUserTelemetryEnv({ vars: currentClaudeVars() });

			const after = JSON.parse(fs.readFileSync(target.path, "utf8"));
			expect(after.hooks).toBeUndefined();
			expect(after.env.OTEL_EXPORTER_OTLP_ENDPOINT).toBe(CURRENT_ENDPOINT);
		});

		it("writes no hook entries onto a device that never had them", () => {
			const target = appSettingsTargetFor("claude")!;
			installAppEnv(target, currentClaudeVars());

			refreshClaudeUserTelemetryEnv({ vars: currentClaudeVars() });

			const after = JSON.parse(fs.readFileSync(target.path, "utf8"));
			expect(after.hooks).toBeUndefined();
		});
	});

	describe("given no persisted block at all", () => {
		it("returns null and writes nothing (the persist offer owns installs)", () => {
			expect(refreshClaudeUserTelemetryEnv({ vars: currentClaudeVars() })).toBe(
				null,
			);
			expect(fs.existsSync(appSettingsTargetFor("claude")!.path)).toBe(false);
		});
	});

	describe("given the user's own OTLP wiring in settings.json", () => {
		it("leaves a non-langwatch-shaped env block byte-for-byte unchanged", () => {
			const target = appSettingsTargetFor("claude")!;
			installAppEnv(target, {
				OTEL_EXPORTER_OTLP_ENDPOINT: "https://api.honeycomb.io",
				OTEL_EXPORTER_OTLP_HEADERS: "x-honeycomb-team=abc",
			});
			const before = fs.readFileSync(target.path, "utf8");

			expect(refreshClaudeUserTelemetryEnv({ vars: currentClaudeVars() })).toBe(
				null,
			);
			expect(fs.readFileSync(target.path, "utf8")).toBe(before);
		});
	});
});
