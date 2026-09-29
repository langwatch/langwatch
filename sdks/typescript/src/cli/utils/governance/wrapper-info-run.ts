/**
 * Help and version runs of a wrapped tool.
 *
 * `langwatch <tool> --help` starts no session, so there is nothing to capture
 * and nothing to set up: no config read, no login, no ingest key, no wiring
 * written. The wrapper recognises such a run from its args alone and hands it
 * to the tool with the calling shell's environment.
 */
import { spawn } from "node:child_process";

import {
	parseProjectScopeFlags,
	parseToolModeFlag,
} from "./wrapper-path-choice";

export type InfoRunKind = "help" | "version";

const HELP_FLAGS = new Set(["--help", "-h"]);
const VERSION_FLAGS = new Set(["--version"]);

/**
 * The kind of informational run the args ask for, or null when they start a
 * session. Only a whole token counts, so a prompt that mentions `-h` is a
 * session, and everything after `--` belongs to the tool's positionals.
 */
export function infoRunKind(args: string[]): InfoRunKind | null {
	for (const arg of args) {
		if (arg === "--") return null;
		if (HELP_FLAGS.has(arg)) return "help";
		if (VERSION_FLAGS.has(arg)) return "version";
	}
	return null;
}

/**
 * The args the tool receives: the user's own, minus the wrapper's flags.
 * Everything from `--` on is the tool's, so a `--project` written there is
 * the tool's own flag and reaches it as typed.
 */
export function infoRunToolArgs(args: string[]): string[] {
	const boundary = args.indexOf("--");
	const beforeBoundary = boundary === -1 ? args : args.slice(0, boundary);
	const fromBoundary = boundary === -1 ? [] : args.slice(boundary);
	// An empty env keeps LANGWATCH_TOOL_MODE out of a parse that only strips.
	const stripped = parseToolModeFlag(
		parseProjectScopeFlags(beforeBoundary).args,
		{},
	).args;
	return [...stripped, ...fromBoundary];
}

/** What the wrapper adds under the tool's own help. */
export function wrapperFlagsHelp(tool: string): string {
	return [
		"",
		`LangWatch options, read by \`langwatch ${tool}\` and not passed to ${tool}:`,
		"  --project <idOrSlug>          Send this tool's telemetry to a team project",
		"  --personal                    Send it to your personal workspace again",
		"  --tool-mode <gateway|otlp>    Route through the gateway, or report over OTLP only",
		"",
	].join("\n");
}

/** Single-quote a string for safe interpolation into a `sh -c` command. */
const shellQuote = (s: string): string => `'${s.replace(/'/g, "'\\''")}'`;

/**
 * The user's interactive shell when it is one whose aliases and functions the
 * wrapper resolves tools through (zsh, bash), else null for a direct spawn.
 */
export function aliasShellFor(
	env: NodeJS.ProcessEnv = process.env,
): string | null {
	const shellName = (env.SHELL ?? "").split("/").pop() ?? "";
	return process.platform !== "win32" &&
		(shellName === "zsh" || shellName === "bash")
		? env.SHELL!
		: null;
}

export const toolNotFoundMessage = (tool: string): string =>
	`${tool} not found in PATH - install it first (https://docs.langwatch.ai/ai-gateway/governance/admin-setup#cli-device-flow-rest-api)`;

/**
 * Run the tool for its help or version and exit with its code. The tool is
 * resolved the way a session resolves it (through the user's shell, so an
 * alias still applies), with the environment of the calling shell.
 */
export async function runInfoRun({
	tool,
	args,
	kind,
}: {
	tool: string;
	args: string[];
	kind: InfoRunKind;
}): Promise<never> {
	const toolArgs = infoRunToolArgs(args);
	const notFound = toolNotFoundMessage(tool);
	const aliasShell = aliasShellFor();
	const child = aliasShell
		? spawn(
				aliasShell,
				[
					"-i",
					"-c",
					`command -v -- ${shellQuote(tool)} >/dev/null 2>&1 || { printf '%s\\n' ${shellQuote(notFound)} >&2; exit 127; }; ${tool} "$@"`,
					tool,
					...toolArgs,
				],
				{ stdio: "inherit", env: process.env },
			)
		: spawn(tool, toolArgs, {
				stdio: "inherit",
				env: process.env,
				shell: process.platform === "win32",
			});
	const exitCode = await new Promise<number>((resolve) => {
		child.on("error", (err) => {
			if ((err as NodeJS.ErrnoException).code === "ENOENT") {
				process.stderr.write(`${notFound}\n`);
				resolve(127);
				return;
			}
			process.stderr.write(`exec ${tool}: ${err.message}\n`);
			resolve(1);
		});
		child.on("close", (code) => resolve(code ?? 1));
	});
	if (kind === "help" && exitCode === 0) {
		process.stdout.write(`${wrapperFlagsHelp(tool)}\n`);
	}
	process.exit(exitCode);
}
