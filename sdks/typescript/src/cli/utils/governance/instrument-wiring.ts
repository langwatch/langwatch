/**
 * Persistent telemetry-wiring installer, shared by `langwatch instrument
 * <tool>` and the project-scope flows. Unlike the per-run refresh in
 * telemetry-refresh.ts (which only re-syncs wiring that is already
 * there), this INSTALLS the wiring whether or not it exists, using the
 * same per-tool targets the wrappers manage:
 *
 *   - claude  -> the `env` block in ~/.claude/settings.json
 *   - codex   -> the [otel] marker block in ~/.codex/config.toml,
 *                Authorization header inline (0600 file)
 *   - gemini / opencode / copilot / code -> a scoped `<tool>()` function
 *                in the shell rc, so the OTel env applies to that tool's
 *                invocations only
 *
 * `langwatch logout` removes every one of these targets.
 */

import * as os from "node:os";

import {
	codexTraceEndpoint,
	displayCodexConfigPath,
	writeCodexOtelBlock,
} from "../codex-config-toml";
import { setOpencodeOpenTelemetryFlag } from "../opencode-config-flag";
import { clearVscodeTerminalOtelEnv } from "./vscode-settings";
import { appSettingsTargetFor, installAppEnv } from "./app-settings";
import { readClaudePluginState } from "./claude-plugin";
import type { GovernanceConfig } from "./config";
import { buildOtelEnvBlock } from "./otel-env-block";
import {
	installSessionContextHooks,
	removeSessionContextHooks,
} from "./session-context-hooks";
import {
	assertCodexTurnHarvest,
	buildScopedToolFunction,
	detectShell,
	persistBlockToRc,
	tildify,
	rcPath,
	toolMarkers,
} from "./shell-rc";

export interface WiringInstallResult {
	/** Human-readable label per target written or confirmed. */
	labels: string[];
	/** Set when a target could not be written (unsupported shell, fs error). */
	warnings: string[];
}

/**
 * Install the persistent wiring for one tool with the given credential.
 * Returns the targets written so the caller can report them. Never
 * throws for a single-target failure; it lands in `warnings` instead.
 */
export function installTelemetryWiring({
	cfg,
	tool,
	endpoint,
	token,
}: {
	cfg: GovernanceConfig;
	tool: string;
	/** OTLP base endpoint (`<control-plane>/api/otel`). */
	endpoint: string;
	token: string;
}): WiringInstallResult {
	const vars = buildOtelEnvBlock(tool, endpoint, token);
	const labels: string[] = [];
	const warnings: string[] = [];

	if (tool === "claude") {
		const target = appSettingsTargetFor("claude");
		if (target) {
			try {
				installAppEnv(target, vars);
				labels.push(target.displayPath);
			} catch (err) {
				warnings.push(
					`could not write ${target.displayPath}: ${(err as Error).message}`,
				);
			}
			// The session context seam reports repository identity; it rides
			// in the same file. Quiet and idempotent; devices carrying the
			// Claude Code plugin get it from the plugin instead.
			try {
				if (readClaudePluginState().pluginInstalled) {
					removeSessionContextHooks({ tool: "claude_code" });
				} else {
					installSessionContextHooks({ tool: "claude_code" });
				}
			} catch {
				// The env is the wiring that matters; the seam is best-effort.
			}
		}
		return { labels, warnings };
	}

	if (tool === "codex") {
		try {
			writeCodexOtelBlock(
				{
					endpoint: codexTraceEndpoint(endpoint),
					ingestionToken: token,
					environment: cfg.organization?.slug ?? "langwatch",
				},
				{ persistAuthHeader: true },
			);
			labels.push(displayCodexConfigPath());
		} catch (err) {
			warnings.push(
				`could not write ${displayCodexConfigPath()}: ${(err as Error).message}`,
			);
		}
		assertCodexTurnHarvest();
		return { labels, warnings };
	}

	// Every remaining tool persists as a scoped shell function so the OTel
	// env applies to `<tool>` runs only, never to other shell children.
	const shell = detectShell();
	if (!shell) {
		warnings.push(
			`unsupported shell (${process.env.SHELL ?? "unknown"}): no rc file to write the scoped ${tool} function to.`,
		);
		return { labels, warnings };
	}
	try {
		persistBlockToRc(
			shell,
			buildScopedToolFunction(tool, vars, shell),
			toolMarkers(tool),
		);
		labels.push(tildify(rcPath(shell)));
	} catch (err) {
		warnings.push(
			`could not write ${tildify(rcPath(shell))}: ${(err as Error).message}`,
		);
	}
	if (tool === "opencode") {
		// opencode only emits spans when `experimental.openTelemetry` is on
		// in its own config; the env vars alone are accepted and ignored.
		try {
			setOpencodeOpenTelemetryFlag();
		} catch (err) {
			warnings.push(
				`could not enable opencode's OpenTelemetry flag: ${(err as Error).message}`,
			);
		}
	}
	if (tool === "code") {
		// The scoped function injects the bearer into a long-lived editor
		// whose integrated terminals inherit it; the terminal clear keeps
		// the token out of them.
		const platform = process.platform;
		if (platform === "darwin" || platform === "linux" || platform === "win32") {
			try {
				clearVscodeTerminalOtelEnv({
					platform,
					home: os.homedir(),
					keys: Object.keys(vars),
				});
			} catch (err) {
				warnings.push(
					`could not apply the VS Code terminal telemetry clear: ${(err as Error).message}`,
				);
			}
		}
	}
	return { labels, warnings };
}
