/**
 * GitHub Copilot **app** capture (sourceType `copilot_app`, ADR-039
 * §Extension).
 *
 * The standalone GitHub Copilot app is a long-running GUI, not a
 * per-invocation CLI, so there is nothing to wrap. It embeds the same
 * OpenTelemetry runtime as the Copilot CLI and, given the standard
 * OTLP-endpoint env vars, pushes one `gen_ai.*` OTLP record per LLM call
 * straight to LangWatch's `/api/otel` — the exact transport already
 * shipped for `copilot_cli` (§Decision, Path B). There is no file to
 * read, no SQLite, no pairing.
 *
 * Two facts force the delivery shape (both spike-verified against the
 * shipped app, build 1.0.71):
 *   1. Copilot enables OTLP export only through environment variables,
 *      and the ingest key travels in an env-only auth header — no config
 *      file can supply it.
 *   2. A GUI launched from the Dock inherits no shell, but the app DOES
 *      inherit env into its spawned runtime engine when launched with it.
 * So a user-level login agent owns the app's launch and sets the capture
 * env on the app process. This module holds the pure, OS-agnostic core:
 * the env block, app detection, and the per-OS login-agent descriptors.
 * The imperative install/remove (writing the descriptor + registering it
 * with the OS) lives in `copilot-app-agent.ts`.
 */

import * as path from "node:path";

import { buildOtelEnvBlock } from "./wrapper-mode";

/** launchd/systemd/Task-Scheduler label — one agent per user. */
export const COPILOT_APP_AGENT_LABEL = "ai.langwatch.copilot-app";

/** Platforms we generate a login agent for. */
export type AppPlatform = "darwin" | "linux" | "win32";

export interface CopilotAppEnvOptions {
  /** OTLP base endpoint the mint returned (`.../api/otel`). Copilot
   * appends `/v1/traces`, so it posts to `.../api/otel/v1/traces`. */
  endpoint: string;
  /** Personal ingest key of sourceType `copilot_app` (the Bearer). */
  token: string;
  /** Capture prompts/responses. On by default; an explicit opt-out drops
   * the content flag so the app emits tokens-only. */
  captureContent: boolean;
}

/**
 * The env the login agent sets on the app process. Reuses the exact
 * Copilot Path-B OTLP block (endpoint + Bearer header + enable +
 * exporter type + protocol + content flag), relabeled `copilot-app` so
 * the surface is distinguishable in resource attributes. Source
 * separation from the CLI is enforced by the distinct `copilot_app`
 * ingest key, stamped at the receiver — not by this label.
 */
export function buildCopilotAppEnv(
  opts: CopilotAppEnvOptions,
): Record<string, string> {
  const env = buildOtelEnvBlock("copilot", opts.endpoint, opts.token);
  env.OTEL_RESOURCE_ATTRIBUTES = "service.name=copilot-app";
  if (!opts.captureContent) {
    delete env.OTEL_INSTRUMENTATION_GENAI_CAPTURE_MESSAGE_CONTENT;
  }
  return env;
}

/**
 * Candidate executables to launch the Copilot app for each platform, in
 * priority order. Launching the executable directly (rather than `open
 * -a`) is what lets the injected env reach the app's spawned runtime
 * engine — verified on macOS.
 */
export function copilotAppCandidatePaths(
  platform: AppPlatform,
  home: string,
  env: Record<string, string | undefined> = {},
): string[] {
  switch (platform) {
    case "darwin":
      return ["/Applications/GitHub Copilot.app/Contents/MacOS/github"];
    case "linux":
      return [
        path.join(home, ".local/share/GitHub Copilot/github-copilot"),
        "/opt/GitHub Copilot/github-copilot",
        "/usr/bin/github-copilot",
      ];
    case "win32": {
      const localAppData =
        env.LOCALAPPDATA ?? path.join(home, "AppData", "Local");
      const programFiles = env.ProgramFiles ?? "C:\\Program Files";
      return [
        path.join(localAppData, "Programs", "GitHub Copilot", "GitHub Copilot.exe"),
        path.join(programFiles, "GitHub Copilot", "GitHub Copilot.exe"),
      ];
    }
  }
}

/**
 * Resolve the app's launch executable, or null when the app is not
 * installed. `exists` is injectable for tests.
 */
export function findCopilotApp(
  platform: AppPlatform,
  home: string,
  exists: (p: string) => boolean,
  env: Record<string, string | undefined> = {},
): string | null {
  for (const candidate of copilotAppCandidatePaths(platform, home, env)) {
    if (exists(candidate)) return candidate;
  }
  return null;
}

export interface LaunchAgentSpec {
  platform: AppPlatform;
  home: string;
  /** Executable the agent launches (from findCopilotApp). */
  execPath: string;
  /** Env the agent sets on that process (from buildCopilotAppEnv). */
  env: Record<string, string>;
}

export interface LaunchAgentDescriptor {
  /** Absolute path the descriptor is written to. */
  path: string;
  /** File content. */
  content: string;
}

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Render the OS-native login-agent descriptor that launches the Copilot
 * app with the capture env at login. Pure: returns the target path and
 * exact file content, so it is fully assertable without touching disk.
 */
export function renderLaunchAgent(spec: LaunchAgentSpec): LaunchAgentDescriptor {
  const entries = Object.entries(spec.env);
  switch (spec.platform) {
    case "darwin": {
      const envXml = entries
        .map(
          ([k, v]) =>
            `    <key>${xmlEscape(k)}</key>\n    <string>${xmlEscape(v)}</string>`,
        )
        .join("\n");
      const content = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>${COPILOT_APP_AGENT_LABEL}</string>
  <key>ProgramArguments</key>
  <array>
    <string>${xmlEscape(spec.execPath)}</string>
  </array>
  <key>EnvironmentVariables</key>
  <dict>
${envXml}
  </dict>
  <key>RunAtLoad</key>
  <true/>
</dict>
</plist>
`;
      return {
        path: path.join(
          spec.home,
          "Library",
          "LaunchAgents",
          `${COPILOT_APP_AGENT_LABEL}.plist`,
        ),
        content,
      };
    }
    case "linux": {
      const envLines = entries
        .map(([k, v]) => `Environment="${k}=${v.replace(/"/g, '\\"')}"`)
        .join("\n");
      const content = `[Unit]
Description=LangWatch capture for the GitHub Copilot app
After=default.target

[Service]
Type=simple
${envLines}
ExecStart=${spec.execPath}

[Install]
WantedBy=default.target
`;
      return {
        path: path.join(
          spec.home,
          ".config",
          "systemd",
          "user",
          `${COPILOT_APP_AGENT_LABEL}.service`,
        ),
        content,
      };
    }
    case "win32": {
      const envXml = entries
        .map(
          ([k, v]) =>
            `        <Variable>\n          <Name>${xmlEscape(k)}</Name>\n          <Value>${xmlEscape(v)}</Value>\n        </Variable>`,
        )
        .join("\n");
      const content = `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <Triggers>
    <LogonTrigger>
      <Enabled>true</Enabled>
    </LogonTrigger>
  </Triggers>
  <Actions>
    <Exec>
      <Command>${xmlEscape(spec.execPath)}</Command>
      <Environment>
${envXml}
      </Environment>
    </Exec>
  </Actions>
</Task>
`;
      return {
        path: path.join(
          spec.home,
          "AppData",
          "Local",
          "LangWatch",
          `${COPILOT_APP_AGENT_LABEL}.xml`,
        ),
        content,
      };
    }
  }
}
