/**
 * Idempotent merge of `experimental.openTelemetry: true` into
 * `~/.config/opencode/opencode.jsonc`.
 *
 * opencode's OTLP exporter is gated on the `experimental.openTelemetry`
 * config flag — without it the SDK is constructed but never exports a
 * single span, even with all the OTEL_EXPORTER_OTLP_* env vars set on
 * the child. Path B (langwatch opencode run) is dead-on-arrival without
 * this flag flipped, so the wrapper writes it on first ingestion mode
 * invocation. Idempotent: if the key is already set true, we don't
 * touch the file. If it's set false explicitly, we DON'T overwrite —
 * the user expressed intent, surface a warning at the call site.
 *
 * The flag lives in `experimental.openTelemetry` per the binary's
 * lookup path `h.experimental?.openTelemetry` — a JSON-style nested
 * key, not a flat one.
 */

import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export interface OpencodeConfigFlagResult {
  /** `created` (new file), `updated` (added/changed flag), `unchanged` (already true), `disabled-by-user` (user set false). */
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
  return s
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
}

/**
 * Set `experimental.openTelemetry = true` in the opencode config.jsonc.
 * Preserves all other top-level keys. Behaviour:
 *
 * - Missing file: write a fresh JSON document with `$schema` +
 *   `experimental.openTelemetry: true`. Action: `created`.
 * - File present, flag missing: deep-merge under `experimental`,
 *   re-serialize the whole document. Action: `updated`.
 * - File present, flag === true: no write. Action: `unchanged`.
 * - File present, flag === false: bail without overwriting; caller
 *   logs a warning so the user knows Path B will silently produce no
 *   spans until they flip it. Action: `disabled-by-user`.
 *
 * JSONC comments + trailing commas in the existing file are preserved
 * approximately by stripping them for parse + re-emitting as plain
 * JSON. A user with a heavily annotated config will lose comments
 * after this runs — acceptable for an experimental flag the wrapper
 * manages.
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

  const experimental =
    (parsed.experimental as Record<string, unknown> | undefined) ?? {};
  const prior = experimental.openTelemetry;
  if (prior === true) return { action: "unchanged", path: filePath };
  if (prior === false) return { action: "disabled-by-user", path: filePath };

  parsed.experimental = { ...experimental, openTelemetry: true };
  fs.writeFileSync(filePath, JSON.stringify(parsed, null, 2) + "\n", {
    mode: 0o600,
  });
  return { action: "updated", path: filePath };
}
