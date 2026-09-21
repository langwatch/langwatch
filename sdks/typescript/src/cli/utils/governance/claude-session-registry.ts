/**
 * The name Claude Code itself holds for a session, read from the live session
 * registry it maintains under `<config dir>/sessions/<pid>.json`: one small
 * JSON file per running claude process, rewritten in place as the session
 * goes, carrying the session id and the current display name (`--name` at
 * launch, `/rename` mid-session, or claude's own derived default).
 *
 * Why the registry and not the hook payload alone: the SessionStart payload
 * carries `session_title` only at session start, and no hook fires on a
 * mid-session `/rename`. The Stop hook runs after every turn, so reading the
 * registry there is what makes a rename reach the platform within one turn.
 *
 * Best-effort by construction: an unreadable directory, a malformed file, an
 * oversized file or an unmatched session id all read as "no name", never as
 * an error — a missing name must never be why a hook broke a session. When
 * several files claim the same session id (a resumed session leaves the old
 * process's file behind until claude prunes it), the newest `updatedAt` wins.
 *
 * Spec: specs/ai-governance/cli-wrappers/session-context-hook.feature
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

/** More files than any real registry holds; a bound, not a quota. */
const MAX_REGISTRY_FILES = 256;

/** A registry entry is a few hundred bytes; past this it is not one. */
const MAX_REGISTRY_FILE_BYTES = 16 * 1024;

/**
 * Where claude keeps the registry. Honours `CLAUDE_CONFIG_DIR` the same way
 * claude itself does, so a relocated config home is still found.
 */
export function defaultClaudeSessionRegistryDir(
	env: NodeJS.ProcessEnv = process.env,
): string {
	const configDir = env.CLAUDE_CONFIG_DIR?.trim();
	if (configDir) return join(configDir, "sessions");
	return join(homedir(), ".claude", "sessions");
}

/**
 * The current name of one session, or null when the registry does not know
 * it. Never throws.
 */
export function readClaudeSessionName({
	sessionId,
	registryDir,
}: {
	sessionId: string;
	registryDir: string;
}): string | null {
	let entries: string[];
	try {
		entries = readdirSync(registryDir);
	} catch {
		return null;
	}

	let name: string | null = null;
	let newest = -1;
	for (const entry of entries.slice(0, MAX_REGISTRY_FILES)) {
		if (!entry.endsWith(".json")) continue;
		const file = join(registryDir, entry);
		try {
			if (statSync(file).size > MAX_REGISTRY_FILE_BYTES) continue;
			const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
			if (typeof parsed !== "object" || parsed === null) continue;
			const record = parsed as Record<string, unknown>;
			if (record.sessionId !== sessionId) continue;
			if (typeof record.name !== "string") continue;
			const updatedAt =
				typeof record.updatedAt === "number" ? record.updatedAt : 0;
			if (updatedAt < newest) continue;
			newest = updatedAt;
			name = record.name;
		} catch {
			// A file claude was mid-write on, or one that is not a registry
			// entry at all. Either way it names nothing.
		}
	}
	return name;
}
