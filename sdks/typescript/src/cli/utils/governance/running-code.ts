import { execFileSync } from "node:child_process";
import { statSync } from "node:fs";

interface RunningProcess {
	pid: number;
	command: string;
}

/**
 * Inspect launchers already running, including ones started by an older CLI.
 * Never print process arguments: they can contain credentials or user content.
 * This cannot see a detached editor after its LangWatch launcher has exited.
 */
export function runningCodeRestartNotice(): string | undefined {
	try {
		const running = listProcesses().some(
			({ pid, command }) => pid !== process.pid && isLangwatchCode(command),
		);
		if (!running) return undefined;
		return "`langwatch code` is already running. Restart `langwatch code` to apply the updated telemetry credentials and destination; fully quit VS Code before relaunching.";
	} catch {
		// Missing utilities, permissions and timeouts must never break setup.
		return undefined;
	}
}

function listProcesses(): RunningProcess[] {
	const options = {
		encoding: "utf8" as const,
		timeout: 1_000,
		maxBuffer: 2 * 1024 * 1024,
		stdio: ["ignore", "pipe", "ignore"] as ["ignore", "pipe", "ignore"],
		windowsHide: true,
	};
	if (process.platform === "win32") {
		const output = execFileSync(
			"powershell.exe",
			[
				"-NoProfile",
				"-NonInteractive",
				"-Command",
				"Get-CimInstance Win32_Process | Select-Object ProcessId,CommandLine | ConvertTo-Json -Compress",
			],
			options,
		);
		const parsed: unknown = JSON.parse(output);
		const records: unknown[] = Array.isArray(parsed) ? parsed : [parsed];
		return records.flatMap((record) => {
			if (!record || typeof record !== "object") return [];
			const entry = record as Record<string, unknown>;
			return typeof entry.ProcessId === "number" &&
				typeof entry.CommandLine === "string"
				? [{ pid: entry.ProcessId, command: entry.CommandLine }]
				: [];
		});
	}
	if (!process.getuid) return [];
	const output = execFileSync(
		"ps",
		["-ww", "-U", String(process.getuid()), "-o", "pid=,args="],
		options,
	);
	return output.split("\n").flatMap((line) => {
		const match = /^\s*(\d+)\s+(.+)$/.exec(line);
		return match ? [{ pid: Number(match[1]), command: match[2]! }] : [];
	});
}

function isLangwatchCode(command: string): boolean {
	// Match executable + subcommand, not a substring inside a shell, grep,
	// another LangWatch command, or a user's prompt. Quotes cover Windows paths.
	const args = (command.match(/"[^"]*"|'[^']*'|\S+/g) ?? []).map((arg) =>
		arg.replace(/^(?:"(.*)"|'(.*)')$/, "$1$2").replace(/\\/g, "/"),
	);
	const executable = readCommandPath(
		args,
		0,
		(value) => isRuntime(value) || isLauncher(value),
	);
	if (!isRuntime(executable.value)) {
		return isLauncher(executable.value) && args[executable.next] === "code";
	}
	const entryIndex = skipRuntimeOptions(args, executable.next);
	if (entryIndex === undefined) return false;
	const entry = readCommandPath(args, entryIndex, isEntrypoint);
	return isEntrypoint(entry.value) && args[entry.next] === "code";
}

const basename = (value: string): string => value.split("/").pop() ?? "";
const isRuntime = (value: string): boolean =>
	/^(?:node|bun)(?:\.exe)?$/.test(basename(value));
const isLauncher = (value: string): boolean =>
	/^(?:langwatch|lw)(?:\.exe)?$/.test(basename(value));
const isEntrypoint = (value: string): boolean =>
	isLauncher(value) ||
	/\/(?:langwatch|sdks\/typescript)\/dist\/cli\/index\.js$/.test(value);

/**
 * POSIX ps discards argv boundaries, including quotes around paths with spaces.
 * Recover a split absolute path only when it names a real file. Stop at the
 * first file so an unrelated script's arguments cannot become our entrypoint.
 * Keep the ordinary/quoted-path case independent of filesystem permissions.
 */
function readCommandPath(
	args: string[],
	index: number,
	recognizes: (value: string) => boolean,
): { value: string; next: number } {
	const first = args[index] ?? "";
	if (recognizes(first) || !/^(?:\/|[A-Za-z]:\/)/.test(first)) {
		return { value: first, next: index + 1 };
	}
	let candidate = "";
	for (let end = index; end < Math.min(args.length, index + 16); end++) {
		candidate += `${end === index ? "" : " "}${args[end]!}`;
		try {
			if (statSync(candidate).isFile())
				return { value: candidate, next: end + 1 };
		} catch {
			// A prefix of a space-containing path normally does not exist.
		}
	}
	return { value: first, next: index + 1 };
}

// Consume option arguments before looking for the script: a preload module is
// not the entrypoint. Unknown options fail closed rather than matching a prompt.
const RUNTIME_VALUE_OPTIONS = new Set([
	"--require",
	"-r",
	"--import",
	"--loader",
	"--experimental-loader",
	"--conditions",
	"-C",
	"--icu-data-dir",
	"--openssl-config",
	"--redirect-warnings",
	"--diagnostic-dir",
	"--max-old-space-size",
	"--stack-trace-limit",
	"--unhandled-rejections",
]);

function skipRuntimeOptions(args: string[], start: number): number | undefined {
	let index = start;
	while (args[index]?.startsWith("-")) {
		const option = args[index]!;
		if (option === "--") return index + 1;
		const name = option.split("=")[0]!;
		if (!process.allowedNodeEnvironmentFlags.has(name)) return undefined;
		index += RUNTIME_VALUE_OPTIONS.has(name) && !option.includes("=") ? 2 : 1;
	}
	return index;
}
