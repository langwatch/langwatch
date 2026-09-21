import { execFileSync } from "node:child_process";
import { afterEach, describe, expect, it, vi } from "vitest";

import { runningCodeRestartNotice } from "../running-code";

vi.mock("node:child_process", () => ({ execFileSync: vi.fn() }));

const originalPlatform = process.platform;
afterEach(() => {
	Object.defineProperty(process, "platform", { value: originalPlatform });
	vi.restoreAllMocks();
});

function processes({
	command,
	pid = process.pid + 1,
}: {
	command: string;
	pid?: number;
}): void {
	vi.mocked(execFileSync).mockReturnValue(
		process.platform === "win32"
			? JSON.stringify([{ ProcessId: pid, CommandLine: command }])
			: `${pid} ${command}\n`,
	);
}

describe("runningCodeRestartNotice()", () => {
	describe("when Windows reports running processes", () => {
		it("detects an npm launcher from CIM output", () => {
			Object.defineProperty(process, "platform", { value: "win32" });
			processes({
				command:
					'"C:\\nodejs\\node.exe" "C:\\npm\\langwatch\\dist\\cli\\index.js" code',
			});
			expect(runningCodeRestartNotice()).toContain("Restart `langwatch code`");
		});

		it("ignores missing command lines and malformed records", () => {
			Object.defineProperty(process, "platform", { value: "win32" });
			vi.mocked(execFileSync).mockReturnValue(
				'[null, {}, {"ProcessId": 1, "CommandLine": null}]',
			);
			expect(runningCodeRestartNotice()).toBeUndefined();
		});
	});
	describe("when a LangWatch code launcher is running", () => {
		it.each([
			"langwatch code .",
			"/usr/local/bin/langwatch code --wait .",
			"node /usr/local/bin/langwatch code .",
			"node /usr/lib/node_modules/langwatch/dist/cli/index.js code .",
			"node /repo/sdks/typescript/dist/cli/index.js code .",
			"node --enable-source-maps /usr/local/bin/langwatch code .",
			"node --require /tmp/preload.js --trace-warnings /usr/local/bin/langwatch code .",
			"node --max-old-space-size=4096 -- /usr/local/bin/langwatch code .",
			"/usr/local/bin/lw code .",
			'"C:\\Program Files\\nodejs\\node.exe" "C:\\npm\\node_modules\\langwatch\\dist\\cli\\index.js" code .',
		])("suggests a restart for %s", (command) => {
			processes({ command });
			expect(runningCodeRestartNotice()).toContain("Restart `langwatch code`");
		});
	});

	describe("when no other LangWatch code launcher is running", () => {
		/** @scenario "Other applications do not trigger the notice" */
		it.each([
			"claude",
			"code .",
			"langwatch claude",
			"langwatch codex",
			"langwatch instrument code --project example",
			"langwatch code-server",
			"node /another/cli/index.js code",
			"sh -c 'langwatch code'",
			"rg langwatch code",
			"node -e 'langwatch code'",
			"node --eval /usr/local/bin/langwatch code",
			"node --print /usr/local/bin/langwatch code",
			"node --require /usr/local/bin/langwatch code",
			"node /another/script.js /usr/local/bin/langwatch code",
			"node /another/script /usr/local/bin/langwatch code",
		])("ignores %s", (command) => {
			processes({ command });
			expect(runningCodeRestartNotice()).toBeUndefined();
		});

		it("excludes the current command", () => {
			processes({ command: "langwatch code", pid: process.pid });
			expect(runningCodeRestartNotice()).toBeUndefined();
		});
	});

	describe("when process inspection fails", () => {
		/** @scenario "Process inspection failure does not fail configuration" */
		it("does not fail configuration or claim a running launcher", () => {
			vi.mocked(execFileSync).mockImplementation(() => {
				throw new Error("process inspection timed out");
			});
			expect(runningCodeRestartNotice()).toBeUndefined();
		});
	});
});
