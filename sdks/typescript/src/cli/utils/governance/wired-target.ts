/**
 * The telemetry target an agent's OWN exporter is wired to, read from the file the agent loads
 * rather than this CLI's cache, which can drift from it (#7958). Reads only; never throws, and
 * a machine with no wiring answers null.
 */
import { codexOtelBlockAuthToken, codexOtelBlockLogsEndpoint } from "../codex-config-toml";
import { appEnvValues, appSettingsTargetFor } from "./app-settings";
import { parseOtlpHeaders } from "./session-context";
import { otelWiringLooksLangwatchAuthored } from "./telemetry-refresh";

/** Where the agent's exporter posts logs, and the bearer it posts with. */
export interface WiredExporterTarget {
  /** The OTLP logs URL, exactly as the agent's exporter resolves it. */
  endpoint: string;
  /** The bearer token, without the `Bearer ` word. */
  token: string;
}

/**
 * The wired target for one agent, or null. `claude_code`: the `env` block of
 * `~/.claude/settings.json`, only when it looks like this CLI's wiring; `codex`: the langwatch
 * marker block of `~/.codex/config.toml`; anything else is null (its env vars reach the hook).
 */
export function readWiredExporterTarget({ agent }: { agent: string }): WiredExporterTarget | null {
  try {
    if (agent === "claude_code") return claudeWiredTarget();
    if (agent === "codex") return codexWiredTarget();
    return null;
  } catch {
    // A wiring file this module cannot read is the same as no wiring: the
    // probe exists to catch a refused key, not to fight a broken disk.
    return null;
  }
}

function claudeWiredTarget(): WiredExporterTarget | null {
  const target = appSettingsTargetFor("claude");
  if (!target) return null;
  const env = appEnvValues(target);
  if (!otelWiringLooksLangwatchAuthored(env)) return null;
  const token = bearerFrom(env.OTEL_EXPORTER_OTLP_HEADERS);
  const endpoint = logsEndpointFrom(env);
  if (!token || !endpoint) return null;
  return { endpoint, token };
}

function codexWiredTarget(): WiredExporterTarget | null {
  const endpoint = codexOtelBlockLogsEndpoint();
  const token = codexOtelBlockAuthToken();
  if (!endpoint || !token) return null;
  return { endpoint, token };
}

/** The logs URL the exporter would use: explicit signal URL, else base + path. */
function logsEndpointFrom(env: Record<string, string>): string | null {
  const explicit = env.OTEL_EXPORTER_OTLP_LOGS_ENDPOINT?.trim();
  if (explicit) return explicit;
  const base = env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim().replace(/\/+$/, "");
  return base ? `${base}/v1/logs` : null;
}

/**
 * The bearer inside an OTLP headers value, without the scheme word. Null for any other scheme:
 * the probe re-sends it as `Bearer <token>`, so a `Basic …` 401 would heal an unrefused wiring.
 */
function bearerFrom(raw: string | undefined): string | null {
  const authorization = parseOtlpHeaders(raw).Authorization?.trim();
  if (!authorization) return null;
  const bearer = /^Bearer\s+(.+)$/i.exec(authorization);
  return bearer?.[1]?.trim() || null;
}
