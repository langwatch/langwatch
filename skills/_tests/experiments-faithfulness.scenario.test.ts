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

describe("Experiments Skill for targeted faithfulness", () => {
	it.skipIf(isCI)(
		"creates a targeted evaluation for RAG faithfulness",
		async () => {
			await withExperimentWorkDir({
				prefix: "langwatch-skill-experiments-targeted-",
				fixtureSubpath: "python-openai",
				run: async (workingDirectory) => {
					const filesBefore = snapshotGeneratedFiles({
						directory: workingDirectory,
						extensions: [".py", ".ipynb"],
					});
					const result = await scenario.run({
						setId: SKILL_TESTS_SET_ID,
						name: "Targeted RAG faithfulness evaluation",
						description:
							"Adding a specific evaluation for checking if the agent's responses are faithful to the context provided.",
						agents: [
							createClaudeCodeAgent({
								workingDirectory,
								omitEnvKeys: ["ANTHROPIC_API_KEY", "OPENAI_API_KEY"],
							}),
							scenario.userSimulatorAgent({ model: experimentsJudgeModel }),
							scenario.judgeAgent({
								model: experimentsJudgeModel,
								criteria: [
									"Agent created an evaluation focused specifically on faithfulness or hallucination detection",
									"The evaluation is targeted, not a generic test suite",
								],
							}),
						],
						script: [
							scenario.user(
								"Create an experiment file that checks if my agent hallucinates using the LangWatch experiments SDK with a faithfulness evaluator. For this code-generation review, do not install dependencies or run it yet.",
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
