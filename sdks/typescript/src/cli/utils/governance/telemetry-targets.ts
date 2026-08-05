/**
 * Enumerate every place `langwatch <tool>` persists telemetry wiring, so
 * `langwatch logout` can discover and remove all of it. Each target knows
 * whether it is currently present on disk and how to remove itself, and
 * every remover only ever touches the langwatch-authored region (a
 * marker-bracketed block or a known key set), never surrounding user
 * config.
 *
 * This is the inverse of the install surface:
 *   - claude   → OTEL keys in ~/.claude/settings.json's `env`, plus the
 *                project-level pin in $CWD/.claude/settings.local.json
 *                (current directory only - other directories' pins are
 *                re-synced or removed by the next wrapper run there)
 *   - codex    → the [otel] + gateway marker blocks in ~/.codex/config.toml
 *                and the sibling langwatch profile file
 *   - gemini / opencode → a scoped shell function under the tool's marker
 *                pair in the shell rc
 *   - the global gateway export block in the shell rc (init-shell / legacy)
 *
 * Shell rc files are scanned for ALL supported shells (zsh/bash/fish), not
 * just $SHELL, so a block written to ~/.zshrc is still found from a bash
 * session — the user asked it to "go and find it".
 */

import * as os from "node:os";

import {
	codexHasGatewayBlock,
	codexHasOtelBlock,
	codexProfileFileIsLangwatchOwned,
	defaultCodexConfigPath,
	defaultCodexProfilePath,
	displayCodexConfigPath,
	removeCodexGatewayBlock,
	removeCodexGatewayProfileFile,
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
	copilotAppAgentPath,
	isCopilotAppAgentInstalled,
	removeCopilotAppAgent,
} from "./copilot-app-agent";
import { telemetryEnvVarNames } from "./otel-env-block";
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
export function scanTelemetryTargets(): TelemetryTarget[] {
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
	}

	// claude — the project-level pin the wrapper maintains in the working
	// directory (`$CWD/.claude/settings.local.json`). Logout can only see
	// the CURRENT directory's pin; pins in other directories are re-synced
	// or removed by the next `langwatch claude` run there. Same provenance
	// requirement as the global target above: `remove()` already gates on
	// it (removeClaudeProjectTelemetryPin), so `present` must match or the
	// confirm list would offer a target whose removal silently no-ops.
	const cwd = process.cwd();
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
