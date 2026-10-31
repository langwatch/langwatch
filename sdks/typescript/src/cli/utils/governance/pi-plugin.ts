/**
 * The pi extension: the backend for the span tree pi already declares and
 * binds to a no-op. Emits pi's own names over OTLP/HTTP and runs
 * `langwatch ingest hook pi`. Deleted when pi ships its own export (ADR-188).
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { PI_EXTENSION_MARKER, piExtensionSource } from "./pi-extension-source";

/** File name of the extension, inside pi's extension directory. */
export const PI_EXTENSION_FILE_NAME = "pi-plugin.ts";

export type PiExtensionAction = "created" | "updated" | "unchanged";

export interface PiExtensionTarget {
  /** Absolute path of the extension file. */
  path: string;
  /** The same path with the home directory collapsed, for display. */
  displayPath: string;
}

export interface PiExtensionInstallResult extends PiExtensionTarget {
  action: PiExtensionAction;
}

/**
 * Where pi looks for global extensions. `PI_CODING_AGENT_DIR` relocates the
 * agent directory whole, which is how pi itself resolves it
 * (`pi-coding-agent/dist/config.js`).
 */
export function piExtensionTarget(dirPath?: string): PiExtensionTarget {
  if (dirPath) {
    const file = path.join(dirPath, PI_EXTENSION_FILE_NAME);
    return { path: file, displayPath: file };
  }
  const agentDir = process.env.PI_CODING_AGENT_DIR?.trim();
  if (agentDir) {
    const file = path.join(agentDir, "extensions", PI_EXTENSION_FILE_NAME);
    return { path: file, displayPath: file };
  }
  return {
    path: path.join(os.homedir(), ".pi", "agent", "extensions", PI_EXTENSION_FILE_NAME),
    displayPath: `~/.pi/agent/extensions/${PI_EXTENSION_FILE_NAME}`,
  };
}

/**
 * Writes the extension, creating the extensions directory when missing.
 * Idempotent: a second run reports `unchanged`. A file already there that
 * isn't ours is left exactly as-is, reported `unchanged` rather than replaced.
 */
export function installPiTelemetryExtension({
  dirPath,
}: { dirPath?: string } = {}): PiExtensionInstallResult {
  const target = piExtensionTarget(dirPath);
  const existing = readFileOrNull(target.path);

  if (existing !== null && !isLangwatchExtension(existing)) {
    return { action: "unchanged", ...target };
  }

  const source = piExtensionSource();
  if (existing === source) return { action: "unchanged", ...target };

  fs.mkdirSync(path.dirname(target.path), { recursive: true });
  fs.writeFileSync(target.path, source);
  return { action: existing === null ? "created" : "updated", ...target };
}

/** Whether our extension is currently on disk, for the logout scan. */
export function hasPiTelemetryExtension({ dirPath }: { dirPath?: string } = {}): boolean {
  const contents = readFileOrNull(piExtensionTarget(dirPath).path);
  return contents !== null && isLangwatchExtension(contents);
}

/**
 * Delete the extension. Returns true when a file of ours was removed; a file
 * at the same path without our marker is left alone, and a missing file is not
 * an error, so this is safe to call unconditionally.
 */
export function removePiTelemetryExtension({ dirPath }: { dirPath?: string } = {}): boolean {
  const target = piExtensionTarget(dirPath);
  const contents = readFileOrNull(target.path);
  if (contents === null || !isLangwatchExtension(contents)) return false;
  try {
    fs.unlinkSync(target.path);
    return true;
  } catch {
    return false;
  }
}

function isLangwatchExtension(contents: string): boolean {
  return contents.startsWith(PI_EXTENSION_MARKER);
}

function readFileOrNull(filePath: string): string | null {
  try {
    return fs.readFileSync(filePath, "utf8");
  } catch {
    return null;
  }
}
