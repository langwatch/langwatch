/**
 * Codex's own session names. Codex keeps one `session_index.jsonl` beside its
 * `sessions/` tree (under `$CODEX_HOME`, `~/.codex` by default): one JSON
 * line per update, `{id, thread_name, updated_at}`, appended as sessions are
 * created and renamed, so the LAST line for an id carries its current name.
 * This is the same index `codex resume <name>` and `codex archive <name>`
 * resolve against — the harvest mirrors it rather than inventing a name.
 *
 * Best-effort by construction: a missing index (older codex), an unreadable
 * file, an oversized one or a line that does not parse all read as "no
 * names". The prompt-derived title stays the fallback for those sessions.
 *
 * Spec: specs/ai-governance/cli-wrappers/codex-rollout-io.feature
 */
import { readFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";

/** Past this the file is read no further; names indexed later are dropped. */
const MAX_INDEX_BYTES = 64 * 1024 * 1024;

/** The index lives beside the sessions tree, not inside it. */
export function codexSessionIndexPath(sessionsRoot: string): string {
	return join(dirname(sessionsRoot), "session_index.jsonl");
}

/**
 * Every session's current name, keyed by session id. Empty on any failure.
 */
export async function readCodexThreadNames(
	indexPath: string,
): Promise<Map<string, string>> {
	const names = new Map<string, string>();
	let raw: string;
	try {
		if ((await stat(indexPath)).size > MAX_INDEX_BYTES) return names;
		raw = await readFile(indexPath, "utf8");
	} catch {
		return names;
	}
	for (const line of raw.split("\n")) {
		if (line.trim() === "") continue;
		try {
			const parsed: unknown = JSON.parse(line);
			if (typeof parsed !== "object" || parsed === null) continue;
			const record = parsed as Record<string, unknown>;
			if (typeof record.id !== "string") continue;
			if (typeof record.thread_name !== "string") continue;
			const name = record.thread_name.trim();
			// Later lines are newer, so the last write for an id wins. A blank
			// name is a write too: a thread renamed back to nothing has no name,
			// and keeping the earlier one would re-post a title codex dropped.
			if (name === "") names.delete(record.id);
			else names.set(record.id, name);
		} catch {
			// A torn tail line while codex is mid-append. It names nothing.
		}
	}
	return names;
}
