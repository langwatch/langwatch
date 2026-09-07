/**
 * Shared fixtures for the three suites that read Claude Code's plugin state:
 * the plugin seam itself, the persist offer that installs it, and the logout
 * target scan that removes it. All three seed the same two files under
 * `~/.claude/plugins`, and a shape that drifts between them would let one suite
 * pass against a file the others prove nothing about.
 *
 * Not named `*.test.ts` on purpose — vitest's `include` is `src/**\/*.test.ts`,
 * so this module is imported by the suites rather than collected as one (same
 * convention as `telemetry-refresh-test-helpers.ts` beside it).
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, type Mock, vi } from "vitest";

import type * as ClaudePluginModuleType from "../claude-plugin";

/** The repository the marketplace we publish from lives in. */
export const OWNED_MARKETPLACE_REPO = "langwatch/agent-plugin";

/**
 * Where every fixture writes. Claude Code keeps all of this under one directory
 * in the user's home, so the suites point HOME at a temp tree and let the module
 * under test resolve the rest for itself, rather than injecting paths it would
 * never be given in production.
 */
export const writeClaudeJson = ({
	home,
	segments,
	value,
}: {
	home: string;
	segments: string[];
	value: unknown;
}): void => {
	const file = path.join(home, ".claude", ...segments);
	fs.mkdirSync(path.dirname(file), { recursive: true });
	fs.writeFileSync(file, JSON.stringify(value, null, 2));
};

/**
 * `installed_plugins.json` with the LangWatch plugin recorded, carrying the
 * bookkeeping fields Claude Code writes beside the scope. `scope` is settable
 * because the update path only manages the user-scope record.
 */
export const seedInstalledPlugin = ({
	home,
	version = "0.1.0",
	scope = "user",
}: {
	home: string;
	version?: string;
	scope?: string;
}): void =>
	writeClaudeJson({
		home,
		segments: ["plugins", "installed_plugins.json"],
		value: {
			version: 2,
			plugins: {
				"langwatch@langwatch": [{ scope, installPath: "/somewhere", version }],
			},
		},
	});

/**
 * `known_marketplaces.json` with a marketplace named `langwatch` sourced from
 * `repo`, and the clone it points at. The default repo is the one we publish;
 * pass another to stand in for somebody else's registration under the same
 * name.
 *
 * `publishedVersion` writes the plugin manifest inside that clone, which is
 * what the update path compares the installed version against. Leaving it out
 * gives a listing whose manifest cannot be read, which is a case of its own.
 */
export const seedMarketplace = ({
	home,
	repo = OWNED_MARKETPLACE_REPO,
	publishedVersion,
}: {
	home: string;
	repo?: string;
	publishedVersion?: string;
}): void => {
	const installLocation = path.join(
		home,
		".claude",
		"plugins",
		"marketplaces",
		"langwatch",
	);
	if (publishedVersion !== undefined) {
		writeClaudeJson({
			home,
			segments: [
				"plugins",
				"marketplaces",
				"langwatch",
				".claude-plugin",
				"plugin.json",
			],
			value: { name: "langwatch", version: publishedVersion },
		});
	}
	writeClaudeJson({
		home,
		segments: ["plugins", "known_marketplaces.json"],
		value: {
			langwatch: {
				source: { source: "github", repo },
				installLocation,
			},
		},
	});
};

export type ClaudePluginModule = typeof ClaudePluginModuleType;

/** The statuses a programmed `claude` answers each plugin subcommand with. */
export interface ClaudeAnswers {
	pluginHelp?: number;
	marketplaceAdd?: number;
	marketplaceUpdate?: number;
	install?: number;
	update?: number;
	uninstall?: number;
	marketplaceRemove?: number;
}

export interface ClaudePluginHarness {
	home: () => string;
	settingsPath: () => string;
	/** Only for the cases that write bytes which are deliberately not JSON. */
	pluginsDir: () => string;
	writeJson: (args: { segments: string[]; value: unknown }) => void;
	readSettings: <T>() => T;
	seedInstalledPlugin: (args?: { version?: string; scope?: string }) => void;
	seedMarketplace: (args?: {
		repo?: string;
		publishedVersion?: string;
	}) => void;
	/** Program the `claude` binary's answers. Anything unset succeeds. */
	answerClaude: (answers: ClaudeAnswers) => void;
	commandsRun: () => string[];
	lastSpawnOptions: () => { stdio: unknown };
	readConfig: () => Record<string, unknown>;
	writeConfig: (extra?: Record<string, unknown>) => void;
	/** A fresh module graph, so the availability probe is memoized once. */
	loadModule: () => Promise<ClaudePluginModule>;
}

const OK = { status: 0, stdout: "", stderr: "" };

/** A programmable `claude`, wired into the caller's own `spawnSync` mock. */
function claudeAnswerer(spawnSyncMock: Mock) {
	return ({
		pluginHelp = 0,
		marketplaceAdd = 0,
		marketplaceUpdate = 0,
		install = 0,
		update = 0,
		uninstall = 0,
		marketplaceRemove = 0,
	}: ClaudeAnswers): void => {
		// A refusal reason belongs to a refusal: a zero status carrying
		// "rejected" on stderr would let a future assertion about WHY something
		// failed pass against a run that succeeded.
		const answer = (status: number, refusal: string) => ({
			...OK,
			status,
			stderr: status === 0 ? "" : refusal,
		});
		spawnSyncMock.mockImplementation((_bin: string, args: string[]) => {
			const joined = args.join(" ");
			if (joined === "plugin --help") return { ...OK, status: pluginHelp };
			if (joined.startsWith("plugin marketplace add")) {
				return answer(marketplaceAdd, "add rejected");
			}
			if (joined.startsWith("plugin marketplace remove")) {
				return { ...OK, status: marketplaceRemove };
			}
			if (joined.startsWith("plugin marketplace update")) {
				return answer(marketplaceUpdate, "listing refresh rejected");
			}
			if (joined.startsWith("plugin install")) {
				return answer(install, "install rejected");
			}
			if (joined.startsWith("plugin update")) {
				return answer(update, "update rejected");
			}
			if (joined.startsWith("plugin uninstall")) {
				return answer(uninstall, "uninstall rejected");
			}
			return OK;
		});
	};
}

/** Read and write the CLI config the suites point `LANGWATCH_CLI_CONFIG` at. */
function configIo() {
	return {
		readConfig: (): Record<string, unknown> =>
			JSON.parse(
				fs.readFileSync(process.env.LANGWATCH_CLI_CONFIG!, "utf8"),
			) as Record<string, unknown>,
		writeConfig: (extra: Record<string, unknown> = {}): void => {
			fs.writeFileSync(
				process.env.LANGWATCH_CLI_CONFIG!,
				JSON.stringify({
					gateway_url: "http://gw.example.com",
					control_plane_url: "http://app.example.com",
					...extra,
				}),
			);
		},
	};
}

/** What the caller's `spawnSync` mock recorded about the `claude` runs. */
function spawnInspectors(spawnSyncMock: Mock) {
	return {
		commandsRun: (): string[] =>
			spawnSyncMock.mock.calls.map((call: unknown[]) =>
				(call[1] as string[]).join(" "),
			),
		lastSpawnOptions: (): { stdio: unknown } => {
			const calls = spawnSyncMock.mock.calls as unknown[][];
			return calls[calls.length - 1]![2] as { stdio: unknown };
		},
	};
}

/**
 * A temp HOME with a CLI config beside it, per test, and everything the suite
 * touched put back afterwards. Absent variables are restored by DELETING them:
 * assigning `undefined` through `process.env` stores the string "undefined",
 * which the next file's HOME resolution would read as a real path.
 */
function registerTempHomeLifecycle({
	state,
	prefix,
	onReady,
}: {
	state: { home: string };
	prefix: string;
	onReady: () => void;
}): void {
	const origHome = process.env.HOME;
	const origUserprofile = process.env.USERPROFILE;
	const origConfig = process.env.LANGWATCH_CLI_CONFIG;

	beforeEach(() => {
		state.home = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
		process.env.HOME = state.home;
		process.env.USERPROFILE = state.home;
		process.env.LANGWATCH_CLI_CONFIG = path.join(state.home, "config.json");
		onReady();
	});

	afterEach(() => {
		if (origHome === undefined) delete process.env.HOME;
		else process.env.HOME = origHome;
		if (origUserprofile === undefined) delete process.env.USERPROFILE;
		else process.env.USERPROFILE = origUserprofile;
		if (origConfig === undefined) delete process.env.LANGWATCH_CLI_CONFIG;
		else process.env.LANGWATCH_CLI_CONFIG = origConfig;
		fs.rmSync(state.home, { recursive: true, force: true });
	});
}

/**
 * Everything the plugin suites need around the module under test: a temp HOME
 * that is torn down per test, a CLI config beside it, and a programmable
 * `claude`. Registers its own `beforeEach` / `afterEach`.
 *
 * The `spawnSync` mock itself stays in the calling file, because `vi.mock` is
 * hoisted per module and cannot be registered from here.
 */
export function installClaudePluginHarness({
	spawnSyncMock,
	prefix,
}: {
	spawnSyncMock: Mock;
	prefix: string;
}): ClaudePluginHarness {
	const state = { home: "" };
	const answerClaude = claudeAnswerer(spawnSyncMock);
	const { readConfig, writeConfig } = configIo();
	const { commandsRun, lastSpawnOptions } = spawnInspectors(spawnSyncMock);
	const settingsPath = (): string =>
		path.join(state.home, ".claude", "settings.json");

	registerTempHomeLifecycle({
		state,
		prefix,
		onReady: () => {
			writeConfig();
			spawnSyncMock.mockReset();
			answerClaude({});
		},
	});

	return {
		home: () => state.home,
		settingsPath,
		pluginsDir: () => path.join(state.home, ".claude", "plugins"),
		writeJson: ({ segments, value }) =>
			writeClaudeJson({ home: state.home, segments, value }),
		readSettings: <T,>() =>
			JSON.parse(fs.readFileSync(settingsPath(), "utf8")) as T,
		seedInstalledPlugin: ({
			version,
			scope,
		}: { version?: string; scope?: string } = {}) =>
			seedInstalledPlugin({ home: state.home, version, scope }),
		seedMarketplace: ({
			repo,
			publishedVersion,
		}: { repo?: string; publishedVersion?: string } = {}) =>
			seedMarketplace({ home: state.home, repo, publishedVersion }),
		answerClaude,
		commandsRun,
		lastSpawnOptions,
		readConfig,
		writeConfig,
		loadModule: async () => {
			vi.resetModules();
			return await import("../claude-plugin.js");
		},
	};
}
