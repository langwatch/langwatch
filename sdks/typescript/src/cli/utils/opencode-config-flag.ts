/**
 * Idempotent merge of `experimental.openTelemetry: true` into opencode's
 * config — without this flag its OTLP exporter never exports a span.
 * Preserves an explicit `false` (user intent) instead of overwriting it.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface OpencodeConfigFlagResult {
  /**
   * `created` (new file), `updated` (added/changed flag), `unchanged`
   * (already true), `disabled-by-user` (user set false).
   */
  action: "created" | "updated" | "unchanged" | "disabled-by-user";
  /** Absolute path of the file that was inspected / written. */
  path: string;
}

/** Default config.jsonc path under the user's home directory. */
export function defaultOpencodeConfigPath(): string {
  const xdg = process.env.XDG_CONFIG_HOME;
  const configHome = xdg && xdg.length > 0 ? xdg : path.join(os.homedir(), ".config");
  return path.join(configHome, "opencode", "opencode.jsonc");
}

/**
 * Strip the most common JSONC noise (// line + /* block comments)
 * before JSON.parse. opencode's default config is a 2-line file with
 * just a $schema field, so this stays simple — not a full JSONC parser.
 */
function stripJsoncComments(s: string): string {
  return s.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
}

/**
 * Sets `experimental.openTelemetry = true` in the opencode config,
 * preserving other top-level keys; returns which of `created`/`updated`/
 * `unchanged`/`disabled-by-user` happened. JSONC comments are not preserved.
 */
export function setOpencodeOpenTelemetryFlag(
  options: { filePath?: string } = {},
): OpencodeConfigFlagResult {
  const filePath = options.filePath ?? defaultOpencodeConfigPath();

  if (!fs.existsSync(filePath)) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    const content =
      JSON.stringify(
        {
          $schema: "https://opencode.ai/config.json",
          experimental: { openTelemetry: true },
        },
        null,
        2,
      ) + "\n";
    fs.writeFileSync(filePath, content, { mode: 0o600 });
    return { action: "created", path: filePath };
  }

  const raw = fs.readFileSync(filePath, "utf8");
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(stripJsoncComments(raw)) as Record<string, unknown>;
  } catch {
    parsed = { $schema: "https://opencode.ai/config.json" };
  }

  const experimental = (parsed.experimental as Record<string, unknown> | undefined) ?? {};
  const prior = experimental.openTelemetry;
  if (prior === true) return { action: "unchanged", path: filePath };
  if (prior === false) return { action: "disabled-by-user", path: filePath };

  parsed.experimental = { ...experimental, openTelemetry: true };
  fs.writeFileSync(filePath, JSON.stringify(parsed, null, 2) + "\n", {
    mode: 0o600,
  });
  return { action: "updated", path: filePath };
}
