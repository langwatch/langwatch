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

describe("Experiments Skill for a Python LangGraph agent", () => {
	it.skipIf(isCI)(
		"creates an evaluation experiment",
		async () => {
			await withExperimentWorkDir({
				prefix: "langwatch-skill-experiments-langgraph-",
				fixtureSubpath: "python-langgraph",
				run: async (workingDirectory) => {
					const filesBefore = snapshotGeneratedFiles({
						directory: workingDirectory,
						extensions: [".py", ".ipynb"],
					});
					const result = await scenario.run({
						setId: SKILL_TESTS_SET_ID,
						name: "Python LangGraph evaluation experiment",
						description:
							"Creating an evaluation experiment for a Python LangGraph agent.",
						agents: [
							createClaudeCodeAgent({
								workingDirectory,
								omitEnvKeys: ["ANTHROPIC_API_KEY", "OPENAI_API_KEY"],
							}),
							scenario.userSimulatorAgent({ model: experimentsJudgeModel }),
							scenario.judgeAgent({
								model: experimentsJudgeModel,
								criteria: [
									"Agent created an evaluation experiment file",
									"Agent generated a dataset relevant to the LangGraph agent functionality",
								],
							}),
						],
						script: [
							scenario.user(
								"Create a batch experiment file for my agent using the langwatch.experiment SDK. For this code-generation review, do not install dependencies or run it yet.",
							),
							scenario.agent(),
							(state) => {
								toolCallFix(state);
								assertSkillWasRead(state, "experiments");
								const createdFiles = findFilesCreatedSince({
									directory: workingDirectory,
									extensions: [".py", ".ipynb"],
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
