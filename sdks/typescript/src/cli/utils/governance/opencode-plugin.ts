/**
 * The opencode plugin that makes a session report the repository it ran in. opencode has no
 * command hooks — a plugin module is its only seam; the session id comes from the event bus
 * (`session.created`'s `properties.info.id`, or `session.idle`'s `properties.sessionID`). It
 * shells out to `langwatch ingest hook opencode`, spawned unreferenced so a slow collector
 * can't block the session opencode awaits it for.
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

/** File name of the plugin, inside the plugins directory. */
export const OPENCODE_PLUGIN_FILE_NAME = "langwatch-session-context.js";

/**
 * First line of the plugin. Ownership is this marker and nothing else: a file
 * at our path that does not carry it belongs to somebody else and is never
 * overwritten or removed.
 */
export const OPENCODE_PLUGIN_MARKER = "// langwatch:session-context-plugin";

/** The command the plugin runs. */
export const OPENCODE_HOOK_COMMAND = "langwatch ingest hook opencode";

export type OpencodePluginAction = "created" | "updated" | "unchanged";

export interface OpencodePluginTarget {
  /** Absolute path of the plugin file. */
  path: string;
  /** The same path with the home directory collapsed, for display. */
  displayPath: string;
}

export interface OpencodePluginInstallResult extends OpencodePluginTarget {
  action: OpencodePluginAction;
}

/**
 * Where opencode looks for global plugins. `plugins/` is the documented name;
 * XDG_CONFIG_HOME relocates the whole config directory when it is set, which is
 * how opencode itself resolves it.
 */
export function opencodePluginTarget(dirPath?: string): OpencodePluginTarget {
  if (dirPath) {
    const file = path.join(dirPath, OPENCODE_PLUGIN_FILE_NAME);
    return { path: file, displayPath: file };
  }
  const xdg = process.env.XDG_CONFIG_HOME?.trim();
  if (xdg) {
    const file = path.join(xdg, "opencode", "plugins", OPENCODE_PLUGIN_FILE_NAME);
    return { path: file, displayPath: file };
  }
  return {
    path: path.join(os.homedir(), ".config", "opencode", "plugins", OPENCODE_PLUGIN_FILE_NAME),
    displayPath: `~/.config/opencode/plugins/${OPENCODE_PLUGIN_FILE_NAME}`,
  };
}

/**
 * Write the plugin, creating the plugins directory when missing. Idempotent:
 * a second run with the same CLI reports `unchanged`. A file already there that
 * is not ours is left exactly as it is, and reported `unchanged` rather than
 * silently replaced.
 */
export function installOpencodeSessionContextPlugin({
  dirPath,
}: { dirPath?: string } = {}): OpencodePluginInstallResult {
  const target = opencodePluginTarget(dirPath);
  const existing = readFileOrNull(target.path);

  if (existing !== null && !isLangwatchPlugin(existing)) {
    return { action: "unchanged", ...target };
  }

  const source = opencodePluginSource();
  if (existing === source) return { action: "unchanged", ...target };

  fs.mkdirSync(path.dirname(target.path), { recursive: true });
  fs.writeFileSync(target.path, source);
  return { action: existing === null ? "created" : "updated", ...target };
}

/** Whether our plugin is currently on disk, for the logout scan. */
export function hasOpencodeSessionContextPlugin({ dirPath }: { dirPath?: string } = {}): boolean {
  const contents = readFileOrNull(opencodePluginTarget(dirPath).path);
  return contents !== null && isLangwatchPlugin(contents);
}

/**
 * Delete the plugin. Returns true when a file of ours was removed; a file at
 * the same path without our marker is left alone, and a missing file is not an
 * error, so this is safe to call unconditionally.
 */
export function removeOpencodeSessionContextPlugin({
  dirPath,
}: { dirPath?: string } = {}): boolean {
  const target = opencodePluginTarget(dirPath);
  const contents = readFileOrNull(target.path);
  if (contents === null || !isLangwatchPlugin(contents)) return false;
  try {
    fs.unlinkSync(target.path);
    return true;
  } catch {
    return false;
  }
}

function isLangwatchPlugin(contents: string): boolean {
  return contents.startsWith(OPENCODE_PLUGIN_MARKER);
}

function readFileOrNull(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}

/**
 * The plugin module, exactly as it lands on disk.
 *
 * `session.created` is the session's first moment and the only event carrying
 * the directory it runs in; `session.idle` closes every turn, which is when a
 * branch switch during the session becomes visible. Both spellings of the id
 * are read because `session.idle` carries only the flat `sessionID`.
 */
function opencodePluginSource(): string {
  return `${OPENCODE_PLUGIN_MARKER}
// Reports the repository, branch and worktree of every opencode session to
// LangWatch, by running the CLI's session context hook. Managed by
// \`langwatch ingest install opencode\`; delete this file to opt out, or run
// \`langwatch logout\` to remove it along with the rest of the wiring.
import { spawn } from "node:child_process";

const COMMAND = ${JSON.stringify(OPENCODE_HOOK_COMMAND.split(" "))};
const EVENTS = { "session.created": "SessionStart", "session.idle": "Stop" };

export const LangWatchSessionContext = async ({ directory }) => ({
  event: async ({ event }) => {
    const hookEvent = EVENTS[event?.type];
    if (!hookEvent) return;

    const properties = event.properties ?? {};
    const info = properties.info ?? {};
    const sessionId = info.id ?? properties.sessionID;
    if (typeof sessionId !== "string" || sessionId === "") return;

    const payload = JSON.stringify({
      session_id: sessionId,
      cwd: info.directory ?? directory,
      hook_event_name: hookEvent,
    });

    // Fire and forget: opencode awaits this handler, so the session must never
    // wait on a collector, and a missing CLI must never surface as an error.
    try {
      const child = spawn(COMMAND[0], COMMAND.slice(1), {
        stdio: ["pipe", "ignore", "ignore"],
      });
      child.on("error", () => {});
      child.stdin.on("error", () => {});
      child.stdin.end(payload);
      child.unref();
    } catch {
      // Nothing a session should ever hear about.
    }
  },
});
`;
}
