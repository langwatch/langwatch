/**
 * The CLI records where it runs from, for processes that can't find it on
 * PATH (e.g. a desktop-launched Claude Code). Hand-run commands record the
 * node binary + entry script for the plugin's hooks to fall back on.
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
  if (!fs.existsSync(resolved)) return null;
  if (!fs.existsSync(execPath)) return null;
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
