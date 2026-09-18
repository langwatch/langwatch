/**
 * Shared fixtures for the latest-login-wins (#6202) suite, split across
 * five files by the unit each exercises: authorship detection, the two
 * per-run refresh functions, the claude project-pin pair, and the
 * login-time orchestrator. Not named `*.test.ts` on purpose — vitest's
 * `include` is `src/**\/*.test.ts`, so this module is imported by the
 * suites rather than collected as one (same convention as
 * `utils/__tests__/output-harness.ts`).
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, vi } from "vitest";

import type { GovernanceConfig } from "../config";
import { buildOtelEnvBlock } from "../otel-env-block";

export const CURRENT_ENDPOINT = "https://langwatch.acme.test/api/otel";
export const CURRENT_TOKEN = "ik-lw-newlogin00000000_freshsecret";
export const STALE_ENDPOINT = "https://app.langwatch.ai/api/otel";
export const STALE_TOKEN = "ik-lw-stalelogin000000_oldsecret";

export const currentClaudeVars = (): Record<string, string> =>
	buildOtelEnvBlock("claude", CURRENT_ENDPOINT, CURRENT_TOKEN);

export function baseCfg(
	overrides: Partial<GovernanceConfig> = {},
): GovernanceConfig {
	return {
		gateway_url: "https://gateway.acme.test",
		control_plane_url: "https://langwatch.acme.test",
		access_token: "tok",
		organization: { id: "o1", slug: "acme" },
		...overrides,
	};
}

export interface TempHomeAndCwd {
	/** Absolute path of the temp $HOME for the CURRENT test (reassigned every beforeEach). */
	home: string;
	/** Absolute path of a temp working directory for the CURRENT test. */
	cwd: string;
}

/**
 * Registers a fresh temp $HOME + $CWD before every test in the CALLING
 * suite, and restores the real environment after. Restoration uses the
 * check-then-delete-or-assign pattern throughout: a direct assignment of a
 * possibly-undefined value coerces to the literal string "undefined" (Node
 * stringifies every env write), which would leak a polluted HOME /
 * USERPROFILE into every later test in the same worker when the var was
 * genuinely unset beforehand.
 */
export function installTempHomeAndCwd(): TempHomeAndCwd {
	const state: TempHomeAndCwd = { home: "", cwd: "" };
	const origHome = process.env.HOME;
	const origUserprofile = process.env.USERPROFILE;
	const origCodexHome = process.env.CODEX_HOME;
	const origCliConfig = process.env.LANGWATCH_CLI_CONFIG;

	beforeEach(() => {
		state.home = fs.mkdtempSync(
			path.join(os.tmpdir(), "lw-telemetry-refresh-"),
		);
		state.cwd = fs.mkdtempSync(path.join(os.tmpdir(), "lw-refresh-cwd-"));
		process.env.HOME = state.home;
		process.env.USERPROFILE = state.home;
		delete process.env.CODEX_HOME;
		// A config of its own switches the login-time refresh off; the suites
		// that want that set it themselves.
		delete process.env.LANGWATCH_CLI_CONFIG;
	});

	afterEach(() => {
		if (origHome === undefined) delete process.env.HOME;
		else process.env.HOME = origHome;
		if (origUserprofile === undefined) delete process.env.USERPROFILE;
		else process.env.USERPROFILE = origUserprofile;
		if (origCodexHome === undefined) delete process.env.CODEX_HOME;
		else process.env.CODEX_HOME = origCodexHome;
		if (origCliConfig === undefined) delete process.env.LANGWATCH_CLI_CONFIG;
		else process.env.LANGWATCH_CLI_CONFIG = origCliConfig;
		fs.rmSync(state.home, { recursive: true, force: true });
		fs.rmSync(state.cwd, { recursive: true, force: true });
		vi.clearAllMocks();
	});

	return state;
}
