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

	describe("when a turn holds a block the conversation has no part for", () => {
		/** @scenario "A block the transcript cannot carry leaves a line naming it" */
		it("keeps the turn and names the block instead of dropping it", () => {
			const messages = claudeCodeTranscriptToModelMessages([
				{
					role: "assistant",
					content: [
						{ type: "text", text: "Here is the screenshot." },
						{ type: "image", source: { type: "base64", data: "iVBORw0KGgo=" } },
					],
				},
			]);

			expect(messages[0]?.content).toEqual([
				{
					type: "text",
					text: "Here is the screenshot.\n[image block, not shown in the transcript]",
				},
			]);
		});

		/** @scenario "A block the transcript cannot carry leaves a line naming it" */
		it("names the block on a user turn as well", () => {
			const messages = claudeCodeTranscriptToModelMessages([
				{
					role: "user",
					content: [{ type: "document", source: { type: "text", data: "x" } }],
				},
			]);

			expect(messages).toEqual([
				{
					role: "user",
					content: "[document block, not shown in the transcript]",
				},
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
	describe("when a tool call carries far more text than a judge can read", () => {
		const huge = "x".repeat(60_000);
		const messages = claudeCodeTranscriptToModelMessages([
			{
				role: "assistant",
				content: [
					{
						type: "tool_use",
						id: "toolu_big",
						name: "Bash",
						input: { command: `cat > report.html <<EOF\n${huge}` },
					},
				],
			},
			{
				role: "user",
				content: [
					{
						type: "tool_result",
						tool_use_id: "toolu_big",
						content: [{ type: "text", text: huge }],
					},
				],
			},
		]);

		it("caps the call input and says how much it dropped", () => {
			const call = (messages[0]!.content as any[])[1];
			expect(call.type).toBe("tool-call");
			expect(call.input.command.length).toBeLessThan(31_000);
			expect(call.input.command).toContain("cat > report.html");
			expect(call.input.command).toMatch(/more characters/);
		});

		it("caps the result the same way", () => {
			const result = (messages[1]!.content as any[])[0];
			expect(result.type).toBe("tool-result");
			expect(result.output.value.length).toBeLessThan(9000);
			expect(result.output.value).toMatch(/more characters/);
		});
		
		it("caps a string nested inside the input too", () => {
			const nested = claudeCodeTranscriptToModelMessages([
				{
					role: "assistant",
					content: [
						{
							type: "tool_use",
							id: "toolu_nested",
							name: "Write",
							input: { payload: { html: huge }, files: [huge] },
						},
					],
				},
			]);

			const call = (nested[0]!.content as any[])[1];
			expect(call.input.payload.html.length).toBeLessThan(31_000);
			expect(call.input.payload.html).toMatch(/more characters/);
			expect(call.input.files[0].length).toBeLessThan(31_000);
		});

		it("leaves a small tool call alone", () => {
			const small = claudeCodeTranscriptToModelMessages([
				{
					role: "assistant",
					content: [
						{
							type: "tool_use",
							id: "toolu_small",
							name: "Bash",
							input: { command: "langwatch virtual-keys list" },
						},
					],
				},
			]);
			expect(bashCommands({ messages: small } as any)).toEqual([
				"langwatch virtual-keys list",
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
