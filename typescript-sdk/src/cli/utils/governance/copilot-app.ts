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

export interface AgentFile {
  /** Absolute path to write. */
  path: string;
  /** Exact file content. */
  content: string;
  /** POSIX mode; token-bearing files are 0o600 so other local users
   * cannot read the ingest key. Ignored on Windows. */
  mode: number;
}

export interface LaunchAgentDescriptor {
  /** The file handed to the OS service manager to register. */
  registerPath: string;
  /** Every file to write (descriptor + any launch wrapper), in write
   * order. Paths are env-independent, so cleanup can be derived by
   * rendering with an empty env. */
  files: AgentFile[];
}

/** 0o600 — token-bearing files must not be world-readable. */
const SECRET_MODE = 0o600;

function xmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/** Windows app dir holding the launch wrapper + task XML. */
function windowsAgentDir(home: string): string {
  return path.join(home, "AppData", "Local", "LangWatch");
}

/**
 * Render the OS-native login-agent files that launch the Copilot app with
 * the capture env at login. Pure: returns exact paths + content, fully
 * assertable without touching disk.
 *
 * Per-platform env-injection mechanism:
 *   - macOS   — launchd `EnvironmentVariables` dict on the plist.
 *   - Linux   — systemd `Environment=` directives (ExecStart is quoted so
 *               an app path with spaces is not word-split).
 *   - Windows — Task Scheduler XML has NO way to set process env, so the
 *               task runs a generated `.cmd` wrapper that `set`s the vars
 *               and then `start`s the app.
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
      const plistPath = path.join(
        spec.home,
        "Library",
        "LaunchAgents",
        `${COPILOT_APP_AGENT_LABEL}.plist`,
      );
      return {
        registerPath: plistPath,
        files: [{ path: plistPath, content, mode: SECRET_MODE }],
      };
    }
    case "linux": {
      const envLines = entries
        .map(([k, v]) => `Environment="${k}=${v.replace(/"/g, '\\"')}"`)
        .join("\n");
      // ExecStart is quoted: the app path may contain spaces (e.g.
      // "/opt/GitHub Copilot/github-copilot"); unquoted, systemd would
      // word-split it into a bogus executable + argument.
      const content = `[Unit]
Description=LangWatch capture for the GitHub Copilot app
After=default.target

[Service]
Type=simple
${envLines}
ExecStart="${spec.execPath}"

[Install]
WantedBy=default.target
`;
      const unitPath = path.join(
        spec.home,
        ".config",
        "systemd",
        "user",
        `${COPILOT_APP_AGENT_LABEL}.service`,
      );
      return {
        registerPath: unitPath,
        files: [{ path: unitPath, content, mode: SECRET_MODE }],
      };
    }
    case "win32": {
      const dir = windowsAgentDir(spec.home);
      const wrapperPath = path.join(dir, `${COPILOT_APP_AGENT_LABEL}.cmd`);
      const xmlPath = path.join(dir, `${COPILOT_APP_AGENT_LABEL}.xml`);

      // Task Scheduler cannot set env in XML; the task runs this wrapper,
      // which sets each var then launches the app. `%` is doubled so cmd
      // does not treat it as a variable reference.
      const setLines = entries
        .map(([k, v]) => `set "${k}=${v.replace(/%/g, "%%")}"`)
        .join("\r\n");
      const wrapper = `@echo off\r\n${setLines}\r\nstart "" "${spec.execPath}"\r\n`;

      const xml = `<?xml version="1.0" encoding="UTF-16"?>
<Task version="1.2" xmlns="http://schemas.microsoft.com/windows/2004/02/mit/task">
  <Triggers>
    <LogonTrigger>
      <Enabled>true</Enabled>
    </LogonTrigger>
  </Triggers>
  <Actions>
    <Exec>
      <Command>${xmlEscape(wrapperPath)}</Command>
    </Exec>
  </Actions>
</Task>
`;
      return {
        registerPath: xmlPath,
        files: [
          { path: wrapperPath, content: wrapper, mode: SECRET_MODE },
          { path: xmlPath, content: xml, mode: SECRET_MODE },
        ],
      };
    }
  }
}
