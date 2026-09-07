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
		/** @scenario "Launch detection handles install paths with spaces and Node runtime flags" */
		it.each([
			{ name: "ordinary launch", folder: "plain", flags: [], preload: false },
			{
				name: "installation path containing spaces",
				folder: "space path",
				flags: [],
				preload: false,
			},
			{
				name: "Node runtime flag",
				folder: "plain",
				flags: ["--enable-source-maps"],
				preload: false,
			},
			{
				name: "spaces and a runtime flag",
				folder: "space path",
				flags: ["--enable-source-maps"],
				preload: false,
			},
			{
				// ps splits `--require /tmp/pre load.js` into two tokens, so a
				// naive two-token skip would mistake `load.js` for the entrypoint.
				name: "a preload path containing spaces",
				folder: "space path",
				flags: [],
				preload: true,
			},
		])("detects $name through the operating system", async ({
			folder,
			flags,
			preload,
		}) => {
			directory = mkdtempSync(join(tmpdir(), "lw-code-process-"));
			const cliDir = join(directory, folder, "langwatch", "dist", "cli");
			mkdirSync(cliDir, { recursive: true });
			const entry = join(cliDir, "index.js");
			writeFileSync(
				entry,
				'setInterval(() => {}, 1000); process.stdout.write("ready");',
			);
			const runtimeArgs = [...flags];
			if (preload) {
				const preloadPath = join(directory, folder, "pre load.js");
				writeFileSync(preloadPath, "");
				runtimeArgs.push("--require", preloadPath);
			}
			child = spawn(process.execPath, [...runtimeArgs, entry, "code"], {
				stdio: ["ignore", "pipe", "pipe"],
			});
			await once(child.stdout!, "data");

			expect(runningCodeRestartNotice()).toContain("Restart `langwatch code`");
		});
	});
});
