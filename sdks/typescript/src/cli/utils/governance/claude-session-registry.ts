/**
 * The name Claude Code holds for a session, from
 * `<config dir>/sessions/<pid>.json`: no hook fires on `/rename`, so
 * reading it from the Stop hook lets a rename reach the platform in one turn.
 */

/**
 * Best-effort: an unreadable, malformed or unmatched file reads as "no
 * name", never an error. Several files claiming one session id: newest wins.
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
export function defaultClaudeSessionRegistryDir(env: NodeJS.ProcessEnv = process.env): string {
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

  return newestSessionName({ registryDir, entries, sessionId });
}

/** The name the most recently updated registry entry gives the session. */
function newestSessionName({
  registryDir,
  entries,
  sessionId,
}: {
  registryDir: string;
  entries: string[];
  sessionId: string;
}): string | null {
  let name: string | null = null;
  let newest = -1;
  for (const entry of entries.slice(0, MAX_REGISTRY_FILES)) {
    if (!entry.endsWith(".json")) continue;
    for (const record of findRegistryRecord(join(registryDir, entry))) {
      if (record.sessionId !== sessionId || typeof record.name !== "string") continue;
      const updatedAt = typeof record.updatedAt === "number" ? record.updatedAt : 0;
      if (updatedAt < newest) continue;
      newest = updatedAt;
      name = record.name;
    }
  }
  return name;
}

/** The record one registry file holds, or none when it is oversized, torn or not an object. */
function findRegistryRecord(file: string): Record<string, unknown>[] {
  try {
    if (statSync(file).size > MAX_REGISTRY_FILE_BYTES) return [];
    const parsed: unknown = JSON.parse(readFileSync(file, "utf8"));
    if (typeof parsed !== "object" || parsed === null) return [];
    return [parsed as Record<string, unknown>];
  } catch {
    // A file claude was mid-write on, or one that is not a registry
    // entry at all. Either way it names nothing.
    return [];
  }
}
