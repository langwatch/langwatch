import scenario from "@langwatch/scenario";
import { describe, expect, it } from "vitest";

import {
	assertSkillWasRead,
	createClaudeCodeAgent,
	SKILL_TESTS_SET_ID,
	toolCallFix,
} from "./helpers/claude-code-adapter";
import {
	experimentsJudgeModel,
	findFilesCreatedSince,
	isCI,
	readGeneratedFiles,
	snapshotGeneratedFiles,
	withExperimentWorkDir,
} from "./helpers/experiments-scenario";

describe("Experiments Skill for a TypeScript Vercel AI bot", () => {
	it.skipIf(isCI)(
		"creates an evaluation experiment",
		async () => {
			await withExperimentWorkDir({
				prefix: "langwatch-skill-experiments-ts-",
				fixtureSubpath: "typescript-vercel",
				run: async (workingDirectory) => {
					const filesBefore = snapshotGeneratedFiles({
						directory: workingDirectory,
						extensions: [".ts", ".tsx"],
					});
					const result = await scenario.run({
						setId: SKILL_TESTS_SET_ID,
						name: "TypeScript Vercel AI evaluation experiment",
						description:
							"Creating an evaluation experiment for a TypeScript Vercel AI chatbot.",
						agents: [
							createClaudeCodeAgent({
								workingDirectory,
								omitEnvKeys: ["ANTHROPIC_API_KEY", "OPENAI_API_KEY"],
							}),
							scenario.userSimulatorAgent({ model: experimentsJudgeModel }),
							scenario.judgeAgent({
								model: experimentsJudgeModel,
								criteria: [
									"Agent created an evaluation experiment file (script or test)",
									"Agent generated a dataset relevant to the agent's functionality",
								],
							}),
						],
						script: [
							scenario.user(
								"Create a batch experiment file for my agent using the LangWatch experiments SDK. For this code-generation review, do not install dependencies or run it yet.",
							),
							scenario.agent(),
							(state) => {
								toolCallFix(state);
								assertSkillWasRead(state, "experiments");
								const createdFiles = findFilesCreatedSince({
									directory: workingDirectory,
									extensions: [".ts", ".tsx"],
									before: filesBefore,
								});
								expect(createdFiles.length).toBeGreaterThan(0);
								expect(
									readGeneratedFiles({
										workingDirectory,
										files: createdFiles,
									}),
								).toContain("langwatch");
							},
							scenario.judge(),
						],
					});
					expect(result.success).toBe(true);
				},
			});
		},
		900_000,
	);
});
