/**
 * The telemetry target an agent's OWN exporter is wired to — read back from
 * the file the agent actually loads, not from this CLI's cache (#7958).
 *
 * The two can drift: `~/.langwatch/config.json` may hold a live key while
 * `~/.claude/settings.json` or `~/.codex/config.toml` still carries a revoked
 * one. The session-context hook posts with the cache, so it succeeds, heals
 * nothing, and every span the agent emits 401s in silence. Whoever wants to
 * know whether the AGENT can be heard has to probe the target the agent
 * exports with — this module says what that target is.
 *
 * Reads only; never throws. A machine with no wiring answers null, and that
 * must cost nothing but the lookup.
 */
import {
  appEnvValues,
  appSettingsTargetFor,
} from "./app-settings";
import { parseOtlpHeaders } from "./session-context";
import { otelWiringLooksLangwatchAuthored } from "./telemetry-refresh";
import {
  codexOtelBlockAuthToken,
  codexOtelBlockLogsEndpoint,
} from "../codex-config-toml";

/** Where the agent's exporter posts logs, and the bearer it posts with. */
export interface WiredExporterTarget {
  /** The OTLP logs URL, exactly as the agent's exporter resolves it. */
  endpoint: string;
  /** The bearer token, without the `Bearer ` word. */
  token: string;
}

/**
 * The wired exporter target for one agent, or null when the agent has no
 * wiring on this machine (or a wiring this module cannot read).
 *
 * - `claude_code`: the `env` block of `~/.claude/settings.json` — the same
 *   block `installTelemetryWiring` writes. The persisted endpoint is the
 *   `/api/otel` base; Claude's exporter appends `/v1/logs`, so this does too.
 *   That block carries no authorship marker, so it is read only when it
 *   looks like wiring this CLI could have written (a langwatch bearer or a
 *   `/api/otel` endpoint — the same test the login refresh applies before it
 *   touches the block). A person's own OTLP wiring to some other collector
 *   is not this CLI's to probe, and a 401 from it is not this CLI's to heal.
 * - `codex`: the langwatch marker block of `~/.codex/config.toml`, which
 *   persists the logs endpoint in full — the markers are the authorship.
 * - `opencode` (and anything else): null. Its wiring is a shell-rc function
 *   that exports plain env vars, and those already reach the hook as the
 *   `environment` target — there is no second file to drift.
 */
export function readWiredExporterTarget({
  agent,
}: {
  agent: string;
}): WiredExporterTarget | null {
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
 * The bearer inside an OTLP headers value, without the scheme word. Null for
 * any other scheme: the probe re-sends the token as `Bearer <token>`, so a
 * `Basic …` value would be probed as a credential the agent never sends, and
 * its 401 would start a heal for a wiring that was never refused.
 */
function bearerFrom(raw: string | undefined): string | null {
  const authorization = parseOtlpHeaders(raw).Authorization?.trim();
  if (!authorization) return null;
  const bearer = /^Bearer\s+(.+)$/i.exec(authorization);
  return bearer?.[1]?.trim() || null;
}
