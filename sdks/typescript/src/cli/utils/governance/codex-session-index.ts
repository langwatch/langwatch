/**
 * Codex's own session names from `session_index.jsonl` (`$CODEX_HOME`):
 * LAST line per id wins, mirroring `codex resume`/`archive`.
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
export async function readCodexThreadNames(indexPath: string): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  let raw: string;
  try {
    if ((await stat(indexPath)).size > MAX_INDEX_BYTES) return names;
    raw = await readFile(indexPath, "utf8");
  } catch {
    return names;
  }
  for (const line of raw.split("\n")) {
    applyThreadName(names, line);
  }
  return names;
}

function applyThreadName(names: Map<string, string>, line: string): void {
  const record = parseThreadName(line);
  if (!record) return;

  // Later lines are newer, so the last write for an id wins. A blank name is
  // a write too: a thread renamed back to nothing has no name, and keeping
  // the earlier one would re-post a title codex dropped.
  const name = record.threadName.trim();
  if (name === "") {
    names.delete(record.id);
    return;
  }
  names.set(record.id, name);
}

function parseThreadName(line: string): { id: string; threadName: string } | null {
  if (line.trim() === "") return null;

  try {
    const parsed: unknown = JSON.parse(line);
    if (!isThreadNameRecord(parsed)) return null;
    return { id: parsed.id, threadName: parsed.thread_name };
  } catch {
    // A torn tail line while codex is mid-append. It names nothing.
    return null;
  }
}

function isThreadNameRecord(value: unknown): value is { id: string; thread_name: string } {
  if (typeof value !== "object" || value === null) return false;
  return (
    "id" in value &&
    typeof value.id === "string" &&
    "thread_name" in value &&
    typeof value.thread_name === "string"
  );
}
