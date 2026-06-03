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

const GW_BEGIN = "# >>> langwatch gateway begin >>>";
const GW_END = "# <<< langwatch gateway end <<<";

export interface CodexGatewayBlockInputs {
  /** Gateway base URL, e.g. https://gateway.langwatch.ai */
  gatewayUrl: string;
  /**
   * Env var name codex should read the API key from. Defaults to
   * OPENAI_API_KEY because that's the standard codex env. The
   * wrapper still sets OPENAI_API_KEY to the user's VK before
   * spawning codex, so this matches the wrapper's env injection
   * out of the box.
   */
  envKey?: string;
}

export interface CodexGatewayWriteResult {
  action: CodexOtelWriteAction;
  path: string;
  /**
   * The profile name codex must be invoked with to actually route
   * through the langwatch provider — e.g. `codex --profile
   * langwatch-gateway`. Returned so the wrapper doesn't have to
   * hardcode the name in two places.
   */
  profile: string;
}

const PROFILE_NAME = "langwatch-gateway";

/**
 * Build the additive [model_providers.langwatch] +
 * [profiles.langwatch-gateway] block. Codex 0.130+ defaults to
 * ChatGPT OAuth and ignores OPENAI_API_KEY unless an explicit
 * model_provider config is selected with `name = "OpenAI"`,
 * `env_key`, and `wire_api = "responses"` (the "chat" wire_api
 * is no longer supported per the codex binary strings dump).
 *
 * We deliberately write a NEW provider entry + a NEW profile so
 * the user's existing top-level `model_provider` / default codex
 * behaviour is untouched. Activation happens via `codex --profile
 * langwatch-gateway`, set by the wrapper at spawn time.
 */
export function buildCodexGatewayBlock(
  inputs: CodexGatewayBlockInputs,
): string {
  const envKey = inputs.envKey ?? "OPENAI_API_KEY";
  const cleanedBase = inputs.gatewayUrl.replace(/\/+$/, "");
  const baseUrl = cleanedBase.endsWith("/v1") ? cleanedBase : `${cleanedBase}/v1`;
  return [
    GW_BEGIN,
    `# Managed by 'langwatch codex' (Path A wrapper). Re-running the`,
    `# wrapper updates this block in place; remove the marker pair`,
    `# above and below to opt back out.`,
    `# The wrapper spawns codex with --profile ${PROFILE_NAME} so this`,
    `# block doesn't change codex's default model_provider.`,
    `[model_providers.langwatch]`,
    `name = "OpenAI"`,
    `base_url = "${baseUrl}"`,
    `env_key = "${envKey}"`,
    `wire_api = "responses"`,
    ``,
    `[profiles.${PROFILE_NAME}]`,
    `model_provider = "langwatch"`,
    GW_END,
    "",
  ].join("\n");
}

/**
 * Idempotent merge of the gateway profile block. Same shape as
 * writeCodexOtelBlock — creates / updates / unchanged. Marker
 * pair is distinct from the [otel] pair so both blocks can
 * coexist without colliding (a user on Path A who later flips to
 * Path B keeps both blocks; only one fires per invocation per
 * the no-double-trace rule).
 */
export function writeCodexGatewayBlock(
  inputs: CodexGatewayBlockInputs,
  options: { filePath?: string } = {},
): CodexGatewayWriteResult {
  const filePath = options.filePath ?? defaultCodexConfigPath();
  const block = buildCodexGatewayBlock(inputs);

  if (!fs.existsSync(filePath)) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, block, { mode: 0o600 });
    return { action: "created", path: filePath, profile: PROFILE_NAME };
  }

  const prior = fs.readFileSync(filePath, "utf8");
  const re = new RegExp(
    `${escapeRe(GW_BEGIN)}[\\s\\S]*?${escapeRe(GW_END)}\\n?`,
    "m",
  );
  if (re.test(prior)) {
    const next = prior.replace(re, block);
    if (next === prior) {
      return { action: "unchanged", path: filePath, profile: PROFILE_NAME };
    }
    fs.writeFileSync(filePath, next, { mode: 0o600 });
    return { action: "updated", path: filePath, profile: PROFILE_NAME };
  }

  const sep = prior.endsWith("\n") ? "\n" : "\n\n";
  fs.writeFileSync(filePath, prior + sep + block, { mode: 0o600 });
  return { action: "updated", path: filePath, profile: PROFILE_NAME };
}

/** Exported so callers + tests can reference the profile name from one place. */
export const CODEX_GATEWAY_PROFILE_NAME = PROFILE_NAME;
