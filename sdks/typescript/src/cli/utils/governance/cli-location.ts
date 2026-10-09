/**
 * The CLI records where it runs from, for the processes that cannot find it.
 *
 * The Claude Code plugin's hooks run whatever `langwatch` they can find, and
 * a Claude Code started from a desktop app inherits a PATH with no version
 * manager on it, so `langwatch` resolves from the user's shell and from
 * nowhere else. The commands a user runs by hand (`login`, `claude`,
 * `instrument`) record the node binary and entry script they ran under into
 * the config, and the plugin's launcher runs the hook commands through that
 * record before falling back to PATH.
 *
 * Best-effort by construction: a location that cannot be determined or a
 * config that cannot be written costs the plugin its first lookup, never the
 * command that was recording it.
 *
 * Spec: specs/ai-governance/agent-plugin/plugin-package.feature
 */

import * as fs from "node:fs";
import * as path from "node:path";

import { type CliLocation, loadConfig, saveConfig } from "./config";

/**
 * Where this process runs from, or null when it cannot be recorded: an entry
 * that is not a file on disk (a compiled binary reports a virtual path) is a
 * record nothing could run.
 */
export function currentCliLocation({
  execPath = process.execPath,
  entry = process.argv[1],
}: {
  execPath?: string;
  entry?: string;
} = {}): CliLocation | null {
  if (!entry) return null;
  const resolved = path.resolve(entry);
  if (!fs.existsSync(resolved) || !fs.existsSync(execPath)) return null;
  return { node: execPath, entry: resolved };
}

/**
 * Write the location into the config, only when it differs from what is
 * there. Returns whether a write happened.
 */
export function recordCliLocation({
  location = currentCliLocation(),
}: {
  location?: CliLocation | null;
} = {}): boolean {
  if (!location) return false;
  try {
    const cfg = loadConfig();
    const recorded = cfg.cli_location;
    if (recorded?.node === location.node && recorded.entry === location.entry) {
      return false;
    }
    cfg.cli_location = location;
    saveConfig(cfg);
    return true;
  } catch {
    return false;
  }
}
