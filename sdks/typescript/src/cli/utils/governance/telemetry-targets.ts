/**
 * Enumerate every place `langwatch <tool>` persists telemetry wiring, so
 * `langwatch logout` can discover and remove all of it. Each target knows
 * whether it is currently present on disk and how to remove itself, and
 * every remover only ever touches the langwatch-authored region (a
 * marker-bracketed block or a known key set), never surrounding user
 * config.
 *
 * This is the inverse of the install surface:
 *   - claude   → OTEL keys in ~/.claude/settings.json's `env`, the session
 *                context hooks in the same file, plus the project-level pin in
 *                $CWD/.claude/settings.local.json (current directory only -
 *                other directories' pins are re-synced or removed by the next
 *                wrapper run there)
 *   - codex    → the [otel] + gateway marker blocks in ~/.codex/config.toml,
 *                the sibling langwatch profile file, and the session context
 *                hooks in ~/.codex/hooks.json
 *   - opencode → the session context plugin file in the plugins directory
 *   - gemini / opencode → a scoped shell function under the tool's marker
 *                pair in the shell rc
 *   - the global gateway export block in the shell rc (legacy installs)
 *
 * Shell rc files are scanned for ALL supported shells (zsh/bash/fish), not
 * just $SHELL, so a block written to ~/.zshrc is still found from a bash
 * session — the user asked it to "go and find it".
 */

import * as os from "node:os";

import {
	codexHasGatewayBlock,
	codexHasNotifyBlock,
	codexHasOtelBlock,
	codexProfileFileIsLangwatchOwned,
	defaultCodexConfigPath,
	defaultCodexProfilePath,
	displayCodexConfigPath,
	removeCodexGatewayBlock,
	removeCodexGatewayProfileFile,
	removeCodexNotifyBlock,
	removeCodexOtelBlock,
} from "../codex-config-toml";
import {
	appEnvHasAnyVar,
	appEnvValues,
	appSettingsTargetFor,
	claudeProjectSettingsTarget,
	removeAppEnvVars,
} from "./app-settings";
import {
	CLAUDE_PLUGIN_MARKETPLACE,
	CLAUDE_PLUGIN_REF,
	readClaudePluginState,
	removeLangwatchClaudeMarketplace,
	uninstallLangwatchClaudePlugin,
} from "./claude-plugin";
import {
	copilotAppAgentPath,
	isCopilotAppAgentInstalled,
	removeCopilotAppAgent,
} from "./copilot-app-agent";
import {
	hasOpencodeSessionContextPlugin,
	opencodePluginTarget,
	removeOpencodeSessionContextPlugin,
} from "./opencode-plugin";
import { telemetryEnvVarNames } from "./otel-env-block";
import {
	hasSessionContextHooks,
	removeSessionContextHooks,
	sessionContextHooksTarget,
} from "./session-context-hooks";
import {
	type DetectedShell,
	GATEWAY_RC_MARKERS,
	rcHasLangwatchBlock,
	rcPath,
	removeBlockFromRc,
	SHELL_FUNCTION_TOOLS,
	tildify,
	toolMarkers,
} from "./shell-rc";
import {
	otelWiringLooksLangwatchAuthored,
	removeClaudeProjectTelemetryPin,
} from "./telemetry-refresh";
import {
	removeVscodeTerminalOtelEnv,
	VSCODE_TELEMETRY_ENV_KEYS,
	type VscodePlatform,
	vscodeTerminalEnvHasAnyClear,
	vscodeUserSettingsPath,
} from "./vscode-settings";

export interface TelemetryTarget {
	/** Human label for the confirm list + removal summary. */
	label: string;
	/** Whether the wiring is currently present on disk. */
	present: boolean;
	/** Remove it. Returns true when something was actually removed. */
	remove: () => boolean;
}

const SHELLS: DetectedShell[] = ["zsh", "bash", "fish"];

/**
 * Enumerate every telemetry-persist target with a present flag and a
 * remover. Callers filter to `present` targets for display + removal.
 */
export function scanTelemetryTargets({
  cwd = process.cwd(),
}: {
  /**
   * The directory whose project pin counts as "this directory". Defaults to
   * the process's own, which is what logout means by it. Passed explicitly by
   * the tests, so a suite that scans and REMOVES project pins cannot reach the
   * checkout it is running inside: `remove()` here deletes real files, and a
   * developer who had run `langwatch claude` in that directory would find the
   * pin gone after a test run.
   */
  cwd?: string;
} = {}): TelemetryTarget[] {
	const targets: TelemetryTarget[] = [];

	// claude — OTEL keys inside ~/.claude/settings.json's `env` object.
	// Target presence alone is not ownership: these are standard OTel env
	// var NAMES (OTEL_EXPORTER_OTLP_ENDPOINT etc.) a user could plausibly
	// have set themselves for an unrelated collector, so both listing and
	// removal require the current VALUES to look langwatch-shaped, not just
	// the key names to match.
	const claudeTarget = appSettingsTargetFor("claude");
	if (claudeTarget) {
		const keys = telemetryEnvVarNames("claude");
		const isClaudeEnvLangwatchOwned = () =>
			otelWiringLooksLangwatchAuthored(appEnvValues(claudeTarget));
		targets.push({
			label: `claude telemetry env (${claudeTarget.displayPath})`,
			present:
				appEnvHasAnyVar(claudeTarget, keys) && isClaudeEnvLangwatchOwned(),
			remove: () =>
				isClaudeEnvLangwatchOwned()
					? removeAppEnvVars(claudeTarget, keys)
					: false,
		});

		// claude, the session context hook entries in the same settings file.
		// Ownership here is unambiguous: an entry is ours only when the command
		// it runs is ours, so a user's own SessionStart or Stop hooks in the
		// same arrays are neither listed nor removed.
		targets.push({
			label: `claude session hooks (${claudeTarget.displayPath})`,
			present: hasSessionContextHooks({ tool: "claude_code" }),
			remove: () => removeSessionContextHooks({ tool: "claude_code" }),
		});
	}

	// claude, the LangWatch plugin and the marketplace it came from. The
	// plugin carries the same session context hooks the entries above declare,
	// so a device that took the plugin has nothing in the settings file to find
	// and this is the only target that speaks for it.
	//
	// Both removers read their own state before they spawn anything, so a
	// machine that never installed the plugin pays no subprocess to discover
	// that, and `present` matches the gate `remove()` applies (an absent plugin
	// and a marketplace somebody else registered both refuse) so the confirm
	// list can never offer a target whose removal silently no-ops.
	const pluginState = readClaudePluginState();
	targets.push({
		label: `claude langwatch plugin (${CLAUDE_PLUGIN_REF})`,
		present: pluginState.pluginInstalled || pluginState.enabled,
		remove: () => {
			const result = uninstallLangwatchClaudePlugin();
			return result.action === "uninstalled" || result.action === "disabled";
		},
	});
	// The marketplace name alone is not ownership: anyone may register one
	// called `langwatch`, and removing theirs would cost them every plugin they
	// installed from it. Only a registration pointing at our repository counts.
	targets.push({
		label: `claude langwatch plugin marketplace (${CLAUDE_PLUGIN_MARKETPLACE})`,
		present: pluginState.marketplaceOwnedByLangwatch,
		remove: () => removeLangwatchClaudeMarketplace(),
	});

	// claude — the project-level pin the wrapper maintains in the working
	// directory (`$CWD/.claude/settings.local.json`). Logout can only see
	// the CURRENT directory's pin; pins in other directories are re-synced
	// or removed by the next `langwatch claude` run there. Same provenance
	// requirement as the global target above: `remove()` already gates on
	// it (removeClaudeProjectTelemetryPin), so `present` must match or the
	// confirm list would offer a target whose removal silently no-ops.
	const claudePin = claudeProjectSettingsTarget(cwd);
	targets.push({
		label: `claude project telemetry pin (${claudePin.displayPath} in this directory)`,
		present:
			appEnvHasAnyVar(claudePin, telemetryEnvVarNames("claude")) &&
			otelWiringLooksLangwatchAuthored(appEnvValues(claudePin)),
		remove: () => removeClaudeProjectTelemetryPin({ cwd }),
	});

	// copilot app — the login agent that owns the app launch (ADR-039
	// §Extension). Present when its descriptor is on disk; removing it
	// unregisters from the OS service manager and deletes the descriptor.
	{
		const appPlatform = os.platform();
		if (
			appPlatform === "darwin" ||
			appPlatform === "linux" ||
			appPlatform === "win32"
		) {
			const home = os.homedir();
			targets.push({
				label: `copilot app capture agent (${tildify(
					copilotAppAgentPath(appPlatform, home),
				)})`,
				present: isCopilotAppAgentInstalled(appPlatform, home),
				remove: () => removeCopilotAppAgent(appPlatform, home),
			});
		}
	}

	// codex — [otel] + gateway marker blocks in config.toml + the profile file.
	const codexConfig = defaultCodexConfigPath();
	targets.push({
		label: `codex [otel] block (${displayCodexConfigPath()})`,
		present: codexHasOtelBlock(codexConfig),
		remove: () => removeCodexOtelBlock(codexConfig),
	});
	// The turn-completion hook that recovers codex conversation content. Its own
	// target rather than a side effect of removing the [otel] block: a user can
	// have installed one without the other, and removal puts back any notify
	// program of theirs we moved aside to take the slot.
	targets.push({
		label: `codex turn harvest hook (${displayCodexConfigPath()})`,
		present: codexHasNotifyBlock(codexConfig),
		remove: () => removeCodexNotifyBlock(codexConfig),
	});
	targets.push({
		label: `codex gateway block (${displayCodexConfigPath()})`,
		present: codexHasGatewayBlock(codexConfig),
		remove: () => removeCodexGatewayBlock(codexConfig),
	});
	// The distinctive path name alone is a strong hint but not proof of
	// ownership; require the content to actually be the profile body this
	// CLI writes before offering to delete whatever file lives there.
	const codexProfile = defaultCodexProfilePath();
	targets.push({
		label: `codex langwatch profile file (${tildify(codexProfile)})`,
		present: codexProfileFileIsLangwatchOwned(codexProfile),
		remove: () => removeCodexGatewayProfileFile(codexProfile),
	});

	// codex, the session context hook entries in its own hooks file. Same
	// ownership rule as claude's: an entry is ours only when the command it
	// runs is ours, so hooks the user wrote are neither listed nor removed.
	targets.push({
		label: `codex session hooks (${sessionContextHooksTarget("codex").displayPath})`,
		present: hasSessionContextHooks({ tool: "codex" }),
		remove: () => removeSessionContextHooks({ tool: "codex" }),
	});

	// opencode, the session context plugin file. Ownership is the marker on
	// its first line, so a file somebody else put at that path is left alone.
	targets.push({
		label: `opencode session plugin (${opencodePluginTarget().displayPath})`,
		present: hasOpencodeSessionContextPlugin(),
		remove: () => removeOpencodeSessionContextPlugin(),
	});

	// shell rc files — the global gateway block + per-tool scoped functions.
	for (const shell of SHELLS) {
		targets.push({
			label: `gateway shell block (${tildify(rcPath(shell))})`,
			present: rcHasLangwatchBlock({ shell, markers: GATEWAY_RC_MARKERS }),
			remove: () => removeBlockFromRc(shell, GATEWAY_RC_MARKERS),
		});
		for (const tool of SHELL_FUNCTION_TOOLS) {
			const markers = toolMarkers(tool);
			targets.push({
				label: `${tool} shell function (${tildify(rcPath(shell))})`,
				present: rcHasLangwatchBlock({ shell, markers }),
				remove: () => removeBlockFromRc(shell, markers),
			});
		}
	}

	// VS Code integrated-terminal telemetry clear (the `code` hardening).
	const vscodePlatform = process.platform;
	if (
		vscodePlatform === "darwin" ||
		vscodePlatform === "linux" ||
		vscodePlatform === "win32"
	) {
		const home = os.homedir();
		const vscodeArgs = {
			platform: vscodePlatform as VscodePlatform,
			home,
			keys: [...VSCODE_TELEMETRY_ENV_KEYS],
		};
		const settingsPath = vscodeUserSettingsPath(
			vscodePlatform as VscodePlatform,
			home,
		);
		targets.push({
			label: `VS Code terminal telemetry clear (${tildify(
				settingsPath ?? "settings.json",
			)})`,
			present: vscodeTerminalEnvHasAnyClear(vscodeArgs),
			remove: () => removeVscodeTerminalOtelEnv(vscodeArgs),
		});
	}

	return targets;
}
