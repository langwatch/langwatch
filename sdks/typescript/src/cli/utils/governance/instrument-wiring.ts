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
	removeBlockFromRc,
	tildify,
	rcPath,
	toolMarkers,
} from "./shell-rc";

export interface WiringInstallResult {
	/** Human-readable label per target written or confirmed. */
	labels: string[];
	/** Set when a target could not be written (unsupported shell, fs error). */
	warnings: string[];
	/**
	 * Set when a companion write the wiring depends on failed. Unlike a
	 * warning, this means the install did not do what it says: the caller
	 * must report a failure rather than a wired tool. Anything already
	 * written that would be unsafe on its own is undone before this is set.
	 */
	requiredFailures: string[];
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
	const requiredFailures: string[] = [];

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
		return { labels, warnings, requiredFailures };
	}

	if (tool === "codex") {
		try {
			writeCodexOtelBlock(
				{
					baseEndpoint: endpoint,
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
		return { labels, warnings, requiredFailures };
	}

	// Every remaining tool persists as a scoped shell function so the OTel
	// env applies to `<tool>` runs only, never to other shell children.
	const shell = detectShell();
	if (!shell) {
		warnings.push(
			`unsupported shell (${process.env.SHELL ?? "unknown"}): no rc file to write the scoped ${tool} function to.`,
		);
		return { labels, warnings, requiredFailures };
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
		// in its own config; the env vars alone are accepted and ignored, so
		// reporting a wired tool here would be reporting a tool that sends
		// nothing.
		try {
			const flag = setOpencodeOpenTelemetryFlag();
			if (flag.action === "disabled-by-user") {
				// The writer leaves an explicit `false` alone rather than
				// overruling the user, and returns instead of throwing, so the
				// result has to be read for the tool to be reported honestly.
				requiredFailures.push(
					`opencode's config sets experimental.openTelemetry to false, so it emits no spans. Remove that line from ${tildify(flag.path)} and run this again.`,
				);
			}
		} catch (err) {
			requiredFailures.push(
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
				// The scoped function puts the bearer where a long-lived editor's
				// integrated terminals inherit it, and the clear is what keeps it
				// out of them. With the clear unwritten the function is unsafe, so
				// it comes back out and the install reports a failure.
				removeBlockFromRc(shell, toolMarkers(tool));
				labels.length = 0;
				requiredFailures.push(
					`could not apply the VS Code terminal telemetry clear, so the scoped \`code\` function was removed again: ${(err as Error).message}`,
				);
			}
		}
	}
	return { labels, warnings, requiredFailures };
}
