import { spawn, type ChildProcess } from "node:child_process";
import { once } from "node:events";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import { runningCodeRestartNotice } from "../running-code";

let child: ChildProcess | undefined;
let directory: string | undefined;

afterEach(async () => {
	if (child?.exitCode === null && child.signalCode === null) {
		const closed = once(child, "close");
		child.kill();
		await closed;
	}
	if (directory) rmSync(directory, { recursive: true, force: true });
});

describe("runningCodeRestartNotice()", () => {
	describe("when an npm-style LangWatch code process is alive", () => {
		it.each([
			{ name: "ordinary launch", folder: "plain", flags: [] },
			{
				name: "installation path containing spaces",
				folder: "space path",
				flags: [],
			},
			{
				name: "Node runtime flag",
				folder: "plain",
				flags: ["--enable-source-maps"],
			},
			{
				name: "spaces and a runtime flag",
				folder: "space path",
				flags: ["--enable-source-maps"],
			},
		])("detects $name through the operating system", async ({
			folder,
			flags,
		}) => {
			directory = mkdtempSync(join(tmpdir(), "lw-code-process-"));
			const cliDir = join(directory, folder, "langwatch", "dist", "cli");
			mkdirSync(cliDir, { recursive: true });
			const entry = join(cliDir, "index.js");
			writeFileSync(
				entry,
				'setInterval(() => {}, 1000); process.stdout.write("ready");',
			);
			child = spawn(process.execPath, [...flags, entry, "code"], {
				stdio: ["ignore", "pipe", "pipe"],
			});
			await once(child.stdout!, "data");

			expect(runningCodeRestartNotice()).toContain("Restart `langwatch code`");
		});
	});
});
