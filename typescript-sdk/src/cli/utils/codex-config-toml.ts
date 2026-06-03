/**
 * Idempotent merge of the LangWatch [otel] activation block into
 * ~/.codex/config.toml.
 *
 * Codex 0.130+ links the opentelemetry-otlp Rust SDK but its
 * exporter is gated on a `[otel]` block in `~/.codex/config.toml` —
 * env vars alone are a silent no-op. The Path B install flow needs
 * to write this block for the user so the drawer / CLI surface
 * can collapse to a single command.
 *
 * Why a handwritten merger and not a TOML library: the file may
 * contain valid TOML the user authored by hand, and we want to
 * preserve ordering + comments verbatim. The merger only ever
 * appends a marker-bracketed block at the end of the file and
 * regex-replaces the same block on re-runs. No structural rewrite
 * of the existing TOML.
 *
 * Marker comments:
 *   # >>> langwatch otel begin >>>
 *   …
 *   # <<< langwatch otel end <<<
 */

import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

const BEGIN = "# >>> langwatch otel begin >>>";
const END = "# <<< langwatch otel end <<<";

export interface CodexOtelBlockInputs {
  /** Full OTLP endpoint, e.g. https://app.langwatch.ai/api/otel */
  endpoint: string;
  /** Plaintext ik-lw-<base32> ingestion token. */
  ingestionToken: string;
  /** Logical environment label (e.g. user@org). Lands on resource.deployment.environment.name. */
  environment?: string;
}

/** Default config.toml path under the user's home directory. */
export function defaultCodexConfigPath(): string {
  const codexHome = process.env.CODEX_HOME;
  if (codexHome) return path.join(codexHome, "config.toml");
  return path.join(os.homedir(), ".codex", "config.toml");
}

/**
 * Build the bracketed [otel] + [otel.exporter.otlp-http] block.
 * Returned WITH leading + trailing markers and a trailing newline.
 */
export function buildCodexOtelBlock(inputs: CodexOtelBlockInputs): string {
  const env = inputs.environment ?? "langwatch";
  // The header key is sent via OTEL_EXPORTER_OTLP_HEADERS at runtime so
  // the toml block never persists the secret; the user only commits
  // the endpoint + environment. We embed a note pointing at the env
  // var so a reader of config.toml can audit the wiring.
  return [
    BEGIN,
    `# Managed by 'langwatch ingestion install codex'. Re-running the`,
    `# command updates this block in place; remove the marker pair`,
    `# above and below to opt back out.`,
    `# Authorization header lives in OTEL_EXPORTER_OTLP_HEADERS;`,
    `# this file persists only the endpoint + environment label.`,
    "[otel]",
    `environment = "${env}"`,
    "",
    "[otel.exporter.otlp-http]",
    `endpoint = "${inputs.endpoint}"`,
    `protocol = "json"`,
    END,
    "",
  ].join("\n");
}

/**
 * Merge result returned by writeCodexOtelBlock so callers can
 * report which action was taken without re-reading the file.
 */
export type CodexOtelWriteAction = "created" | "updated" | "unchanged";

export interface CodexOtelWriteResult {
  action: CodexOtelWriteAction;
  path: string;
}

/**
 * Idempotent merge into the codex config.toml. Behaviour:
 *
 * - If the file does not exist: create the parent dir if needed,
 *   write the block as the entire file contents.
 * - If the file exists with NO marker pair: append the block + a
 *   leading blank line so it doesn't fuse with the prior section.
 * - If the file exists WITH a marker pair: regex-replace the
 *   bracketed region. The replacement is byte-for-byte the same
 *   when the inputs haven't changed → returns 'unchanged'.
 */
export function writeCodexOtelBlock(
  inputs: CodexOtelBlockInputs,
  options: { filePath?: string } = {},
): CodexOtelWriteResult {
  const filePath = options.filePath ?? defaultCodexConfigPath();
  const block = buildCodexOtelBlock(inputs);

  if (!fs.existsSync(filePath)) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, block, { mode: 0o600 });
    return { action: "created", path: filePath };
  }

  const prior = fs.readFileSync(filePath, "utf8");
  const re = new RegExp(
    `${escapeRe(BEGIN)}[\\s\\S]*?${escapeRe(END)}\\n?`,
    "m",
  );
  if (re.test(prior)) {
    const next = prior.replace(re, block);
    if (next === prior) return { action: "unchanged", path: filePath };
    fs.writeFileSync(filePath, next, { mode: 0o600 });
    return { action: "updated", path: filePath };
  }

  const sep = prior.endsWith("\n") ? "\n" : "\n\n";
  fs.writeFileSync(filePath, prior + sep + block, { mode: 0o600 });
  return { action: "updated", path: filePath };
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
