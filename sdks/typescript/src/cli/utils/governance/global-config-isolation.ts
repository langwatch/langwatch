/**
 * Warns when wiring a local instance is about to rewrite the machine's global
 * agent configuration.
 *
 * `langwatch login` writes `~/.langwatch/config.json` and `langwatch instrument
 * <tool>` writes the tool's own global file (`~/.claude/settings.json`,
 * `~/.codex/config.toml`). Pointed at a local dev instance, both replace the
 * production wiring every other session on the machine reads, so the next
 * `langwatch ingest context` and every agent's telemetry export go to a port
 * that is only up while the dev server is. Nothing here refuses the run: QA
 * against a local instance is the point. It names the isolation env vars once.
 *
 * Spec: specs/ai-governance/cli-wrappers/instrument-command.feature
 * Spec: specs/ai-governance/cli-onboarding/login-unified.feature
 */

import { isLoopbackHost } from "./ingest-endpoint-scheme";

/** Set by the caller that already relocated the CLI config out of `~`. */
const CONFIG_ENV_VAR = "LANGWATCH_CLI_CONFIG";

/**
 * Whether `endpoint` is a local instance the caller has not isolated. False as
 * soon as `LANGWATCH_CLI_CONFIG` is set: that shell already keeps its config
 * somewhere of its own, which is exactly what the warning would ask for.
 */
export function rewritesGlobalConfigForLocalInstance({
	endpoint,
	env = process.env,
}: {
	endpoint: string | undefined;
	env?: NodeJS.ProcessEnv;
}): boolean {
	if (env[CONFIG_ENV_VAR]?.trim()) return false;
	if (!endpoint?.trim()) return false;
	try {
		return isLoopbackHost(new URL(endpoint.trim()).hostname);
	} catch {
		return false;
	}
}

/**
 * The one line a person reads before a local instance takes over the global
 * wiring. Names the three env vars that give a QA shell its own home, so the
 * global files keep pointing at production.
 */
export function globalConfigIsolationWarning(endpoint: string): string {
	return `this points the machine's global config at a local instance (${safeHost(endpoint)}), so every other session on this machine follows it. To keep the global wiring on production, export LANGWATCH_CLI_CONFIG, CLAUDE_CONFIG_DIR and CODEX_HOME to a scratch directory for this shell.`;
}

function safeHost(endpoint: string): string {
	try {
		return new URL(endpoint.trim()).host;
	} catch {
		return "that host";
	}
}
