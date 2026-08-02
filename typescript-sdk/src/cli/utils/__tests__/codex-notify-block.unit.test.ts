/**
 * The `notify` block is what makes a plain `codex` (no langwatch wrapper in
 * front) record its conversation: codex runs the configured program after every
 * completed turn, and our harvest turns that into trace content.
 *
 * Two properties here are load-bearing in a way that is easy to get wrong and
 * silent when wrong, so they are pinned hard:
 *
 *  1. `notify` is a TOML top-level key. Written after the `[otel]` block the
 *     way our other blocks are, TOML binds it to that table as `otel.notify`,
 *     which codex ignores without a word of complaint.
 *  2. TOML forbids a duplicate key. Leaving a user's own `notify` in place
 *     next to ours does not merely lose their program, it stops codex from
 *     parsing its config at all.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
	buildCodexNotifyBlock,
	codexHasNotifyBlock,
	codexNotifyCommand,
	removeCodexNotifyBlock,
	writeCodexNotifyBlock,
} from "../codex-config-toml";

const HARVEST = ["/usr/bin/node", "/opt/langwatch/cli.js", "ingest", "codex"];

let tmp: string;
let configPath: string;

beforeEach(() => {
	tmp = fs.mkdtempSync(path.join(os.tmpdir(), "lw-codex-notify-"));
	configPath = path.join(tmp, "config.toml");
});

afterEach(() => {
	fs.rmSync(tmp, { recursive: true, force: true });
});

/**
 * The TOML table a bare key lands in: the last `[section]` header above it, or
 * null when it is top-level. This is the actual rule codex's parser applies, so
 * asserting on it beats asserting the key sits at some byte offset.
 */
function tableOwning(content: string, key: string): string | null {
	const lines = content.split("\n");
	let table: string | null = null;
	for (const line of lines) {
		const section = /^[ \t]*\[([^\]]+)\]/.exec(line);
		if (section) {
			table = section[1] ?? null;
			continue;
		}
		if (new RegExp(`^[ \\t]*${key}[ \\t]*=`).test(line)) return table;
	}
	throw new Error(`no assignment for '${key}' found`);
}

describe("buildCodexNotifyBlock", () => {
	describe("given a harvest command", () => {
		describe("when the block is built", () => {
			/** @scenario "Enabling capture asks codex to run the harvest after every turn" */
			it("emits a notify key running that command, bracketed by langwatch markers", () => {
				const block = buildCodexNotifyBlock({ command: HARVEST });

				expect(block).toContain("# >>> langwatch codex notify begin >>>");
				expect(block).toContain("# <<< langwatch codex notify end <<<");
				expect(block).toContain(
					'notify = ["/usr/bin/node", "/opt/langwatch/cli.js", "ingest", "codex", "--notify"]',
				);
			});
		});
	});

	describe("given a user program to chain", () => {
		describe("when the block is built", () => {
			it("passes the chain before --notify, which has to stay last to receive the payload", () => {
				const block = buildCodexNotifyBlock({
					command: HARVEST,
					chained: ["/usr/bin/terminal-notifier", "-title", "Codex"],
				});

				const argv = /notify = \[(.*)\]/.exec(block)?.[1] ?? "";
				expect(argv.indexOf("--chain")).toBeLessThan(argv.indexOf("--notify"));
				expect(block).toContain("terminal-notifier");
			});
		});
	});
});

describe("writeCodexNotifyBlock", () => {
	describe("given a config file that already has sections", () => {
		describe("when the block is written", () => {
			/** @scenario "The harvest hook is still readable when the configuration already has sections" */
			it("keeps notify top-level rather than binding it to the preceding table", () => {
				fs.writeFileSync(
					configPath,
					[
						'model = "gpt-5.6-sol"',
						"",
						"[otel]",
						'environment = "langwatch"',
						"",
						"[otel.trace_exporter.otlp-http]",
						'endpoint = "https://app.langwatch.ai/api/otel/v1/traces"',
						"",
					].join("\n"),
				);

				writeCodexNotifyBlock({ command: HARVEST }, { filePath: configPath });

				const content = fs.readFileSync(configPath, "utf8");
				expect(tableOwning(content, "notify")).toBeNull();
			});

			it("leaves the user's existing settings intact", () => {
				fs.writeFileSync(
					configPath,
					[
						'model = "gpt-5.6-sol"',
						"",
						"[otel]",
						'environment = "mine"',
						"",
					].join("\n"),
				);

				writeCodexNotifyBlock({ command: HARVEST }, { filePath: configPath });

				const content = fs.readFileSync(configPath, "utf8");
				expect(content).toContain('model = "gpt-5.6-sol"');
				expect(content).toContain("[otel]");
				expect(content).toContain('environment = "mine"');
			});
		});
	});

	describe("given no config file yet", () => {
		describe("when the block is written", () => {
			it("creates the file holding just the block", () => {
				const result = writeCodexNotifyBlock(
					{ command: HARVEST },
					{ filePath: configPath },
				);

				expect(result.action).toBe("created");
				expect(codexHasNotifyBlock(configPath)).toBe(true);
				expect(
					tableOwning(fs.readFileSync(configPath, "utf8"), "notify"),
				).toBeNull();
			});
		});
	});

	describe("given the block was already written", () => {
		describe("when capture is enabled again with the same command", () => {
			/** @scenario "Enabling capture twice leaves a single harvest hook" */
			it("reports no change and leaves exactly one notify key", () => {
				writeCodexNotifyBlock({ command: HARVEST }, { filePath: configPath });
				const result = writeCodexNotifyBlock(
					{ command: HARVEST },
					{ filePath: configPath },
				);

				const content = fs.readFileSync(configPath, "utf8");
				expect(result.action).toBe("unchanged");
				expect(content.match(/^[ \t]*notify[ \t]*=/gm)).toHaveLength(1);
				expect(content.match(/langwatch codex notify begin/g)).toHaveLength(1);
			});
		});

		describe("when the harvest command changes", () => {
			it("rewrites the single block rather than stacking a second one", () => {
				writeCodexNotifyBlock({ command: HARVEST }, { filePath: configPath });
				const result = writeCodexNotifyBlock(
					{
						command: [
							...HARVEST.slice(0, 1),
							"/opt/langwatch/cli2.js",
							"ingest",
							"codex",
						],
					},
					{ filePath: configPath },
				);

				const content = fs.readFileSync(configPath, "utf8");
				expect(result.action).toBe("updated");
				expect(content.match(/^[ \t]*notify[ \t]*=/gm)).toHaveLength(1);
				expect(content).toContain("cli2.js");
			});
		});
	});

	describe("given the user already set their own notify program", () => {
		describe("when the block is written", () => {
			/** @scenario "A turn-completion program the user already had keeps running" */
			it("chains their program so it still runs after every turn", () => {
				fs.writeFileSync(
					configPath,
					[
						'notify = ["/usr/bin/terminal-notifier", "-title", "Codex"]',
						"",
						"[otel]",
						'environment = "mine"',
						"",
					].join("\n"),
				);

				const result = writeCodexNotifyBlock(
					{ command: HARVEST },
					{ filePath: configPath },
				);

				expect(result.chained).toEqual([
					"/usr/bin/terminal-notifier",
					"-title",
					"Codex",
				]);
				expect(codexNotifyCommand(configPath)).toContain("--chain");
				expect(fs.readFileSync(configPath, "utf8")).toContain(
					"terminal-notifier",
				);
			});

			it("leaves exactly one live notify key, since a duplicate stops codex parsing its config", () => {
				fs.writeFileSync(
					configPath,
					[
						'notify = ["/usr/bin/terminal-notifier"]',
						"",
						"[otel]",
						'environment = "mine"',
						"",
					].join("\n"),
				);

				writeCodexNotifyBlock({ command: HARVEST }, { filePath: configPath });

				const live = fs
					.readFileSync(configPath, "utf8")
					.split("\n")
					.filter((line) => /^[ \t]*notify[ \t]*=/.test(line));
				expect(live).toHaveLength(1);
			});
		});
	});
});

describe("removeCodexNotifyBlock", () => {
	describe("given a config carrying the block", () => {
		describe("when capture is turned off", () => {
			/** @scenario "Turning capture off removes the harvest hook" */
			it("drops the block and leaves the rest of the file alone", () => {
				fs.writeFileSync(
					configPath,
					[
						'model = "gpt-5.6-sol"',
						"",
						"[otel]",
						'environment = "mine"',
						"",
					].join("\n"),
				);
				writeCodexNotifyBlock({ command: HARVEST }, { filePath: configPath });

				expect(removeCodexNotifyBlock(configPath)).toBe(true);

				const content = fs.readFileSync(configPath, "utf8");
				expect(codexHasNotifyBlock(configPath)).toBe(false);
				expect(content).not.toMatch(/^[ \t]*notify[ \t]*=/m);
				expect(content).toContain('model = "gpt-5.6-sol"');
				expect(content).toContain("[otel]");
			});
		});
	});

	describe("given the block displaced a user's own notify", () => {
		describe("when capture is turned off", () => {
			it("gives the user their notify back, live again rather than commented out", () => {
				const original =
					'notify = ["/usr/bin/terminal-notifier", "-title", "Codex"]';
				fs.writeFileSync(
					configPath,
					[original, "", "[otel]", 'environment = "mine"', ""].join("\n"),
				);
				writeCodexNotifyBlock({ command: HARVEST }, { filePath: configPath });

				removeCodexNotifyBlock(configPath);

				const content = fs.readFileSync(configPath, "utf8");
				expect(content).toContain(original);
				expect(codexNotifyCommand(configPath)).toEqual([
					"/usr/bin/terminal-notifier",
					"-title",
					"Codex",
				]);
				expect(tableOwning(content, "notify")).toBeNull();
			});
		});
	});

	describe("given a config with no block", () => {
		describe("when removal runs", () => {
			it("reports nothing removed instead of failing", () => {
				fs.writeFileSync(configPath, 'model = "gpt-5.6-sol"\n');
				expect(removeCodexNotifyBlock(configPath)).toBe(false);
			});
		});
	});
});

describe("codexNotifyCommand", () => {
	describe("given a config with no notify key", () => {
		describe("when the command is read", () => {
			it("returns null rather than an empty argv a caller would try to run", () => {
				fs.writeFileSync(configPath, '[otel]\nenvironment = "mine"\n');
				expect(codexNotifyCommand(configPath)).toBeNull();
			});
		});
	});

	describe("given a notify argv spread over several lines", () => {
		describe("when the command is read", () => {
			it("reads the whole argv, not just its first line", () => {
				fs.writeFileSync(
					configPath,
					[
						"notify = [",
						'  "/usr/bin/notifier",',
						'  "-title",',
						'  "Codex",',
						"]",
						"",
					].join("\n"),
				);

				expect(codexNotifyCommand(configPath)).toEqual([
					"/usr/bin/notifier",
					"-title",
					"Codex",
				]);
			});
		});
	});
});
