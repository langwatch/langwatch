/**
 * The command-hook entries that make a session report the repository it ran in,
 * merged into the hook file of whichever agent declares them.
 *
 * Two agents take command hooks today and they take them in the same shape: a
 * top-level `hooks` object keyed by event name, each event holding matcher
 * groups whose `hooks` array carries `{ type: "command", command, timeout }`.
 * Claude Code reads it from `~/.claude/settings.json`, beside the telemetry env
 * block (see app-settings.ts); Codex reads it from `hooks.json` in its config
 * home. One merge serves both, and the only per-agent facts live in `TARGETS`.
 *
 * Both agents fire `SessionStart` at the top of a session and `Stop` at the end
 * of every turn. One entry per event is all this needs: the command behind them
 * decides for itself when there is anything new to report.
 *
 * Codex additionally asks the user to review a newly declared hook before it
 * will run it, and the trust it records is a hash of the declaration written
 * into Codex's own config. That grant is the user's to give, so installing
 * writes the declaration and says so; nothing here forges the trust record.
 *
 * Ownership doctrine, the same one telemetry-targets.ts applies everywhere
 * else: hook arrays are shared with the user, so an entry is ours only when the
 * command it runs is one of ours. Every other entry, in the same array or
 * beside it, is read past and written back untouched: installing must never
 * cost someone their own hooks, and logout must never take them.
 *
 * Spec: specs/ai-governance/cli-wrappers/session-context-hook.feature
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import {
	appSettingsTargetFor,
	readAppSettingsFile,
	readAppSettingsFileForUpdate,
} from "./app-settings";

/** The agents whose session context rides on a command hook. */
export type HookedTool = "claude_code" | "codex";

/**
 * What marks an entry as ours. The prefix rather than the whole command, so an
 * entry written by an older CLI (or for another agent) is still recognised as
 * langwatch-authored and gets replaced or removed rather than duplicated.
 */
const OWNED_COMMAND_PREFIX = "langwatch ingest hook";

/** The two events a session's git context can have changed between. */
const HOOK_EVENTS = ["SessionStart", "Stop"] as const;

/** Seconds the agent gives the hook before it kills it. */
const HOOK_TIMEOUT_SECONDS = 10;

export interface HooksTarget {
	/** Absolute path of the hook file. */
	path: string;
	/** The same path with the home directory collapsed, for display. */
	displayPath: string;
}

interface ToolSpec {
	/** The tool argument `langwatch ingest hook` is called with. */
	hookArgument: string;
	/** Where the hook declarations live, resolved at call time. */
	resolveTarget: () => HooksTarget;
}

const TARGETS: Record<HookedTool, ToolSpec> = {
	claude_code: {
		hookArgument: "claude-code",
		resolveTarget: () => {
			// app-settings owns the claude settings location, and always has one.
			const target = appSettingsTargetFor("claude")!;
			return { path: target.path, displayPath: target.displayPath };
		},
	},
	codex: {
		hookArgument: "codex",
		resolveTarget: () => {
			// CODEX_HOME relocates the whole config directory, hooks included.
			const home = process.env.CODEX_HOME?.trim();
			if (home) {
				const file = path.join(home, "hooks.json");
				return { path: file, displayPath: file };
			}
			return {
				path: path.join(os.homedir(), ".codex", "hooks.json"),
				displayPath: "~/.codex/hooks.json",
			};
		},
	},
};

/** The command an installed hook entry runs, for one agent. */
export function sessionContextHookCommand(tool: HookedTool): string {
	return `${OWNED_COMMAND_PREFIX} ${TARGETS[tool].hookArgument}`;
}

/** Where a tool's hooks live, for the logout scan's label. */
export function sessionContextHooksTarget(tool: HookedTool): HooksTarget {
	return TARGETS[tool].resolveTarget();
}

export type SessionContextHooksAction = "created" | "updated" | "unchanged";

export interface SessionContextHooksInstallResult extends HooksTarget {
	action: SessionContextHooksAction;
}

/**
 * Merge the session-context hooks into the tool's hook file, creating it and
 * its directory when missing. Idempotent: running twice leaves exactly one
 * entry per event, and reports `unchanged` the second time.
 *
 * Throws when an existing file cannot be read as a JSON object: the write
 * replaces it wholesale, and the user's own hooks live in there too.
 */
export function installSessionContextHooks({
	tool,
	filePath,
}: {
	tool: HookedTool;
	filePath?: string;
}): SessionContextHooksInstallResult {
	const target = resolveTarget({ tool, filePath });
	const existedBefore = fs.existsSync(target.path);

	const document = readAppSettingsFileForUpdate(target.path);
	const before = JSON.stringify(document);

	const hooks = isPlainObject(document.hooks) ? document.hooks : {};
	for (const event of HOOK_EVENTS) {
		hooks[event] = mergeHookEntries(hooks[event], tool);
	}
	document.hooks = hooks;

	if (JSON.stringify(document) === before) {
		return { action: "unchanged", ...target };
	}

	fs.mkdirSync(path.dirname(target.path), { recursive: true });
	fs.writeFileSync(target.path, JSON.stringify(document, null, 2) + "\n");
	return { action: existedBefore ? "updated" : "created", ...target };
}

/**
 * Whether the tool's hook file currently carries any langwatch hook entry. Used
 * by the logout scan to decide whether there is anything to offer.
 */
export function hasSessionContextHooks({
	tool,
	filePath,
}: {
	tool: HookedTool;
	filePath?: string;
}): boolean {
	const document = readAppSettingsFile(resolveTarget({ tool, filePath }).path);
	if (!isPlainObject(document.hooks)) return false;
	return Object.values(document.hooks).some(
		(entries) => Array.isArray(entries) && entries.some(isLangwatchHookEntry),
	);
}

/**
 * Strip every langwatch hook entry from the tool's hook file, leaving the
 * user's own entries (and every other key) exactly as they were. An event left
 * with no entries loses its key, and an empty `hooks` object goes with it, so
 * removal leaves no residue. Returns true when the file changed.
 *
 * A file we cannot parse is left alone rather than rewritten: there is no way
 * to strip our entries from JSON we could not read without losing the rest.
 */
export function removeSessionContextHooks({
	tool,
	filePath,
}: {
	tool: HookedTool;
	filePath?: string;
}): boolean {
	const target = resolveTarget({ tool, filePath });

	let raw: string;
	try {
		raw = fs.readFileSync(target.path, "utf8");
	} catch {
		return false; // ENOENT
	}
	let parsed: unknown;
	try {
		parsed = JSON.parse(raw) as unknown;
	} catch {
		return false; // malformed, do not touch
	}
	if (!isPlainObject(parsed)) return false;

	const document: Record<string, unknown> = { ...parsed };
	if (!isPlainObject(document.hooks)) return false;
	const hooks: Record<string, unknown> = { ...document.hooks };

	let removed = false;
	for (const [event, entries] of Object.entries(hooks)) {
		if (!Array.isArray(entries)) continue;
		const kept = entries.filter((entry) => !isLangwatchHookEntry(entry));
		if (kept.length === entries.length) continue;
		removed = true;
		if (kept.length === 0) delete hooks[event];
		else hooks[event] = kept;
	}
	if (!removed) return false;

	if (Object.keys(hooks).length === 0) delete document.hooks;
	else document.hooks = hooks;

	fs.writeFileSync(target.path, JSON.stringify(document, null, 2) + "\n");
	return true;
}

/**
 * The entries for one event with ours asserted: an existing entry of ours that
 * already matches keeps its position, anything else of ours is replaced by
 * exactly one current entry, and the user's entries keep their order.
 */
function mergeHookEntries(raw: unknown, tool: HookedTool): unknown[] {
	const entries = Array.isArray(raw) ? (raw as unknown[]) : [];
	const ours = entries.filter(isLangwatchHookEntry);
	const desired = sessionContextHookEntry(tool);

	if (ours.length === 1 && JSON.stringify(ours[0]) === JSON.stringify(desired)) {
		return entries;
	}
	return [...entries.filter((entry) => !isLangwatchHookEntry(entry)), desired];
}

/** No matcher: every session start counts, whatever started it. */
function sessionContextHookEntry(tool: HookedTool): Record<string, unknown> {
	return {
		hooks: [
			{
				type: "command",
				command: sessionContextHookCommand(tool),
				timeout: HOOK_TIMEOUT_SECONDS,
			},
		],
	};
}

function isLangwatchHookEntry(entry: unknown): boolean {
	if (!isPlainObject(entry) || !Array.isArray(entry.hooks)) return false;
	return entry.hooks.some((hook) => {
		if (!isPlainObject(hook)) return false;
		const command = hook.command;
		return (
			typeof command === "string" && command.startsWith(OWNED_COMMAND_PREFIX)
		);
	});
}

function resolveTarget({
	tool,
	filePath,
}: {
	tool: HookedTool;
	filePath: string | undefined;
}): HooksTarget {
	if (filePath) return { path: filePath, displayPath: filePath };
	return TARGETS[tool].resolveTarget();
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value);
}
