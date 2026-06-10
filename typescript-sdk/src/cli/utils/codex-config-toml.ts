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
  /** Plaintext personal ingest key (sk-lw-<...>). */
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
 * Build the bracketed [otel] + [otel.trace_exporter.otlp-http] block.
 * Returned WITH leading + trailing markers and a trailing newline.
 *
 * codex 0.137+ separates `trace_exporter` (spans) from `exporter`
 * (logs) in its config schema. We emit the trace_exporter form so
 * Path B span ingestion fires; the older `[otel.exporter.otlp-http]`
 * form is silently ignored on traces in the current schema.
 */
export function buildCodexOtelBlock(inputs: CodexOtelBlockInputs): string {
  const env = inputs.environment ?? "langwatch";
  // The header key is sent via OTEL_EXPORTER_OTLP_HEADERS at runtime so
  // the toml block never persists the secret; the user only commits
  // the endpoint + environment. We embed a note pointing at the env
  // var so a reader of config.toml can audit the wiring.
  return [
    BEGIN,
    `# Managed by 'langwatch ingest install codex'. Re-running the`,
    `# command updates this block in place; remove the marker pair`,
    `# above and below to opt back out.`,
    `# Authorization header lives in OTEL_EXPORTER_OTLP_HEADERS;`,
    `# this file persists only the endpoint + environment label.`,
    "[otel]",
    `environment = "${env}"`,
    "",
    "[otel.trace_exporter.otlp-http]",
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
  /**
   * The ~/.codex/config.toml path that received the
   * [model_providers.langwatch] block.
   */
  path: string;
  /**
   * The separate ~/.codex/<profile>.config.toml path that received
   * the profile body. codex 0.134+ rejects [profiles.X] entries
   * inside config.toml when the user passes --profile X, requiring
   * a sibling file named <profile>.config.toml.
   */
  profilePath: string;
  /**
   * Result of the profile-file write. Independent of `action` so
   * callers can report both writes accurately.
   */
  profileAction: CodexOtelWriteAction;
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
 * Build the additive [model_providers.langwatch] block that lives
 * in ~/.codex/config.toml. Codex 0.130+ defaults to ChatGPT OAuth
 * and ignores OPENAI_API_KEY unless an explicit model_provider
 * config is selected with `name = "OpenAI"`, `env_key`, and
 * `wire_api = "responses"` (the "chat" wire_api is no longer
 * supported per the codex binary strings dump).
 *
 * Codex 0.134+ rejects a [profiles.<name>] entry inside
 * config.toml when the user passes --profile <name>; the profile
 * body is now written to a sibling file (see buildCodexGatewayProfileFile).
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
    `# provider doesn't change codex's default model_provider.`,
    `# The matching profile body lives at ~/.codex/${PROFILE_NAME}.config.toml`,
    `# (codex 0.134+ requires the profile in a separate file).`,
    `[model_providers.langwatch]`,
    `name = "OpenAI"`,
    `base_url = "${baseUrl}"`,
    `env_key = "${envKey}"`,
    `wire_api = "responses"`,
    GW_END,
    "",
  ].join("\n");
}

/**
 * Build the contents of the sibling profile file
 * (~/.codex/langwatch-gateway.config.toml). The filename IS the
 * profile name; the body holds the settings that previously went
 * under [profiles.langwatch-gateway] inside config.toml.
 *
 * We DO NOT bracket this file with langwatch markers because the
 * file is entirely owned by langwatch — the wrapper creates it
 * fresh on every invocation. Hand-edits to it will be overwritten
 * (a header comment explains this to anyone reading the file).
 */
export function buildCodexGatewayProfileFile(): string {
  return [
    `# Managed by 'langwatch codex' (Path A wrapper).`,
    `# This file is the body of the '${PROFILE_NAME}' codex profile,`,
    `# selected at spawn time via 'codex --profile ${PROFILE_NAME}'.`,
    `# The matching [model_providers.langwatch] entry lives in`,
    `# ~/.codex/config.toml, bracketed by langwatch marker comments.`,
    `# Re-running 'langwatch codex' regenerates this file in place;`,
    `# remove it and the [model_providers.langwatch] block in`,
    `# config.toml to opt back out.`,
    `model_provider = "langwatch"`,
    "",
  ].join("\n");
}

/** Default path for the sibling profile file. */
export function defaultCodexProfilePath(profile: string = PROFILE_NAME): string {
  const codexHome = process.env.CODEX_HOME;
  const baseDir = codexHome ?? path.join(os.homedir(), ".codex");
  return path.join(baseDir, `${profile}.config.toml`);
}

/**
 * Idempotent merge of the gateway provider block into config.toml
 * + write of the sibling profile file. Both writes happen in one
 * call so the wrapper can't end up with a half-installed state.
 *
 * config.toml: regex-replace inside the marker pair or append. The
 * [otel] marker pair (Path B) coexists independently — a user who
 * runs both Path A and Path B keeps both blocks; only one fires per
 * invocation per the no-double-trace rule.
 *
 * <profile>.config.toml: full-file replace. The file is entirely
 * owned by langwatch.
 */
export function writeCodexGatewayBlock(
  inputs: CodexGatewayBlockInputs,
  options: { filePath?: string; profilePath?: string } = {},
): CodexGatewayWriteResult {
  const filePath = options.filePath ?? defaultCodexConfigPath();
  const profilePath = options.profilePath ?? defaultCodexProfilePath();
  const block = buildCodexGatewayBlock(inputs);
  const profileBody = buildCodexGatewayProfileFile();

  let action: CodexOtelWriteAction;
  if (!fs.existsSync(filePath)) {
    fs.mkdirSync(path.dirname(filePath), { recursive: true });
    fs.writeFileSync(filePath, block, { mode: 0o600 });
    action = "created";
  } else {
    const prior = fs.readFileSync(filePath, "utf8");
    const re = new RegExp(
      `${escapeRe(GW_BEGIN)}[\\s\\S]*?${escapeRe(GW_END)}\\n?`,
      "m",
    );
    if (re.test(prior)) {
      const next = prior.replace(re, block);
      if (next === prior) {
        action = "unchanged";
      } else {
        fs.writeFileSync(filePath, next, { mode: 0o600 });
        action = "updated";
      }
    } else {
      const sep = prior.endsWith("\n") ? "\n" : "\n\n";
      fs.writeFileSync(filePath, prior + sep + block, { mode: 0o600 });
      action = "updated";
    }
  }

  let profileAction: CodexOtelWriteAction;
  if (!fs.existsSync(profilePath)) {
    fs.mkdirSync(path.dirname(profilePath), { recursive: true });
    fs.writeFileSync(profilePath, profileBody, { mode: 0o600 });
    profileAction = "created";
  } else {
    const priorProfile = fs.readFileSync(profilePath, "utf8");
    if (priorProfile === profileBody) {
      profileAction = "unchanged";
    } else {
      fs.writeFileSync(profilePath, profileBody, { mode: 0o600 });
      profileAction = "updated";
    }
  }

  return { action, path: filePath, profilePath, profileAction, profile: PROFILE_NAME };
}

/** Exported so callers + tests can reference the profile name from one place. */
export const CODEX_GATEWAY_PROFILE_NAME = PROFILE_NAME;
