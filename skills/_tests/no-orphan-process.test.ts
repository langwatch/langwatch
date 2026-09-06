import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

import {
	createSkillTestWorkDir,
	removeSkillTestWorkDir,
} from "./helpers/claude-code-adapter";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const skillsRoot = path.resolve(__dirname, "..");
const harnessPath = path.join(__dirname, "helpers", "no-orphan-harness.ts");

/**
 * A stand-in for the Claude Code CLI: it starts a child of its own, writes both
 * pids where the test can read them, and then runs until killed. Nothing here
 * reacts to the harness dying, so the only thing that can stop these two
 * processes is the lifecycle guard the Scenario SDK adapter installs.
 */
function fakeClaudeScript(workingDirectory: string): string {
	return `#!/bin/sh
sleep 600 &
printf '%s\\n' "$!" > "${workingDirectory}/claude-child.pid"
printf '%s\\n' "$$" > "${workingDirectory}/claude.pid"
while :; do sleep 1; done
`;
}

function isRunning(pid: number): boolean {
	try {
		process.kill(pid, 0);
		return true;
	} catch {
		return false;
	}
}

function readPid(pidPath: string): number | undefined {
	if (!fs.existsSync(pidPath)) return undefined;
	const pid = Number.parseInt(fs.readFileSync(pidPath, "utf8").trim(), 10);
	return Number.isInteger(pid) && pid > 0 ? pid : undefined;
}

async function waitUntil(
	condition: () => boolean,
	{ timeoutMs, what }: { timeoutMs: number; what: string },
): Promise<void> {
	const deadline = Date.now() + timeoutMs;
	while (Date.now() < deadline) {
		if (condition()) return;
		await new Promise((resolve) => setTimeout(resolve, 250));
	}
	throw new Error(`Timed out after ${timeoutMs}ms waiting for ${what}`);
}

function killIfRunning(pid: number | undefined): void {
	if (pid === undefined || !isRunning(pid)) return;
	try {
		process.kill(pid, "SIGKILL");
	} catch {
		// Already gone between the check and the signal.
	}
}

describe("given a killed test worker that was running Claude Code", () => {
	// The lifecycle guard uses process groups, which Windows does not have.
	/** @scenario "No Claude Code process outlives the test harness" */
	it.skipIf(process.platform === "win32")(
		"stops Claude Code and everything it started",
		async () => {
			const workingDirectory = createSkillTestWorkDir("no-orphan-");
			const binDir = path.join(workingDirectory, "bin");
			fs.mkdirSync(binDir, { recursive: true });
			fs.writeFileSync(
				path.join(binDir, "claude"),
				fakeClaudeScript(workingDirectory),
				{ mode: 0o755 },
			);

			const harness = spawn(
				process.execPath,
				["--import", "tsx", harnessPath, workingDirectory],
				{ cwd: skillsRoot, stdio: "ignore" },
			);

			let claudePid: number | undefined;
			let claudeChildPid: number | undefined;
			try {
				await waitUntil(
					() => {
						claudePid = readPid(path.join(workingDirectory, "claude.pid"));
						claudeChildPid = readPid(
							path.join(workingDirectory, "claude-child.pid"),
						);
						return claudePid !== undefined && claudeChildPid !== undefined;
					},
					{ timeoutMs: 120_000, what: "the agent to spawn Claude Code" },
				);

				expect(isRunning(claudePid as number)).toBe(true);
				expect(isRunning(claudeChildPid as number)).toBe(true);

				harness.kill("SIGKILL");

				await waitUntil(
					() =>
						!isRunning(claudePid as number) &&
						!isRunning(claudeChildPid as number),
					{
						timeoutMs: 30_000,
						what: "Claude Code and its child to stop after the worker was killed",
					},
				);
			} finally {
				harness.kill("SIGKILL");
				killIfRunning(claudeChildPid);
				killIfRunning(claudePid);
				removeSkillTestWorkDir(workingDirectory);
			}
		},
		180_000,
	);
});
