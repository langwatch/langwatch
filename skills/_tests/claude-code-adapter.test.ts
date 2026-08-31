import fs from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
	bashCommands,
	claudeCodeTranscriptToModelMessages,
	createSkillTestWorkDir,
	ensureClaudeSkillInstructions,
	installSkillToWorkDir,
	removeSkillTestWorkDir,
} from "./helpers/claude-code-adapter";

describe("Claude Code transcript conversion", () => {
	const transcript = [
		{
			role: "assistant",
			content: [
				{ type: "thinking", thinking: "Read the skill first.", signature: "s" },
				{ type: "text", text: "I'll start by reading the skill instructions." },
				{
					type: "tool_use",
					id: "toolu_01",
					name: "Bash",
					input: { command: "cat .skills/scenarios/SKILL.md" },
				},
			],
		},
		{
			role: "user",
			content: [
				{
					type: "tool_result",
					tool_use_id: "toolu_01",
					content: [{ type: "text", text: "# Scenarios skill" }],
				},
			],
		},
		{
			role: "assistant",
			content: [{ type: "text", text: "Done." }],
		},
	];

	describe("when the transcript holds thinking, text, tool_use and tool_result blocks", () => {
		/** @scenario "The Claude Code adapter of the skill tests reports tool calls as AI SDK parts" */
		it("emits AI SDK model messages with tool-call and tool-result parts", () => {
			const messages = claudeCodeTranscriptToModelMessages(transcript);

			expect(messages).toEqual([
				{
					role: "assistant",
					content: [
						{
							type: "text",
							text: "I'll start by reading the skill instructions.",
						},
						{
							type: "tool-call",
							toolCallId: "toolu_01",
							toolName: "Bash",
							input: { command: "cat .skills/scenarios/SKILL.md" },
						},
					],
				},
				{
					role: "tool",
					content: [
						{
							type: "tool-result",
							toolCallId: "toolu_01",
							toolName: "Bash",
							output: { type: "text", value: "# Scenarios skill" },
						},
					],
				},
				{ role: "assistant", content: [{ type: "text", text: "Done." }] },
			]);
			expect(JSON.stringify(messages)).not.toContain("Read the skill first.");
		});

		it("reads the Bash commands from the converted transcript", () => {
			const messages = claudeCodeTranscriptToModelMessages(transcript);
			expect(bashCommands({ messages } as never)).toEqual([
				"cat .skills/scenarios/SKILL.md",
			]);
		});
	});

	describe("when an assistant turn only calls tools", () => {
		it("keeps an empty text part so the tool calls stay next to a string content", () => {
			const messages = claudeCodeTranscriptToModelMessages([
				{
					role: "assistant",
					content: [
						{ type: "tool_use", id: "toolu_02", name: "Read", input: { file: "x" } },
					],
				},
			]);
			expect(messages[0]?.content).toEqual([
				{ type: "text", text: "" },
				{
					type: "tool-call",
					toolCallId: "toolu_02",
					toolName: "Read",
					input: { file: "x" },
				},
			]);
		});
	});
});

describe("Claude Code skill discovery", () => {
	it("preserves existing instructions and appends each missing skill once", () => {
		const workingDirectory = createSkillTestWorkDir(
			"claude-skill-discovery-",
		);
		try {
			fs.writeFileSync(
				path.join(workingDirectory, "CLAUDE.md"),
				"Keep these existing project instructions.\n",
			);
			installSkillToWorkDir({
				workingDirectory,
				skillSubpath: "experiments",
			});
			installSkillToWorkDir({
				workingDirectory,
				skillSubpath: "online-evaluations",
			});

			ensureClaudeSkillInstructions(workingDirectory);
			ensureClaudeSkillInstructions(workingDirectory);

			const contents = fs.readFileSync(
				path.join(workingDirectory, "CLAUDE.md"),
				"utf8",
			);
			expect(contents).toContain("Keep these existing project instructions.");
			expect(contents.match(/\.skills\/experiments\/SKILL\.md/g)).toHaveLength(
				1,
			);
			expect(
				contents.match(/\.skills\/online-evaluations\/SKILL\.md/g),
			).toHaveLength(1);
		} finally {
			removeSkillTestWorkDir(workingDirectory);
		}
	});

	describe("given dogfood artifact preservation is enabled", () => {
		it("keeps the generated workspace available for inspection", () => {
			const workingDirectory = createSkillTestWorkDir(
				"claude-skill-preservation-",
			);
			const previousValue = process.env.KEEP_SKILL_TEST_WORKDIR;
			try {
				process.env.KEEP_SKILL_TEST_WORKDIR = "1";
				removeSkillTestWorkDir(workingDirectory);
				expect(fs.existsSync(workingDirectory)).toBe(true);
			} finally {
				if (previousValue === undefined) {
					delete process.env.KEEP_SKILL_TEST_WORKDIR;
				} else {
					process.env.KEEP_SKILL_TEST_WORKDIR = previousValue;
				}
				fs.rmSync(workingDirectory, { recursive: true, force: true });
			}
		});
	});
});
