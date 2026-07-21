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

describe("Experiments Skill for a domain-specific RAG agent", () => {
	it.skipIf(isCI)(
		"creates a domain-specific evaluation",
		async () => {
			await withExperimentWorkDir({
				prefix: "langwatch-skill-experiments-rag-",
				fixtureSubpath: "python-rag-agent",
				run: async (workingDirectory) => {
					const filesBefore = snapshotGeneratedFiles({
						directory: workingDirectory,
						extensions: [".py", ".ipynb"],
					});
					const result = await scenario.run({
						setId: SKILL_TESTS_SET_ID,
						name: "RAG agent domain-specific evaluation",
						description:
							"Creating an evaluation experiment for a farm advisory RAG agent.",
						agents: [
							createClaudeCodeAgent({
								workingDirectory,
								omitEnvKeys: ["ANTHROPIC_API_KEY", "OPENAI_API_KEY"],
							}),
							scenario.userSimulatorAgent({ model: experimentsJudgeModel }),
							scenario.judgeAgent({
								model: experimentsJudgeModel,
								criteria: [
									"Agent created an evaluation experiment with domain-specific data about agriculture, irrigation, frost protection, or pest management",
									"Dataset does not contain generic trivia and has realistic agronomic questions",
								],
							}),
						],
						script: [
							scenario.user(
								"Create a batch experiment file for my farm advisory RAG agent. Read the codebase to understand the knowledge base and domain. Generate a dataset with realistic agronomic questions and use the langwatch.experiment SDK. For this code-generation review, do not install dependencies or run it yet.",
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
								const contents = readGeneratedFiles({
									workingDirectory,
									files: createdFiles,
								}).toLowerCase();
								expect(contents).toContain("langwatch");
								expect(
									["irrigation", "frost", "pest", "soil", "crop"].some(
										(term) => contents.includes(term),
									),
									"expected dataset to contain agricultural domain terms",
								).toBe(true);
								expect(contents).not.toMatch(
									/capital of france|what is 2 ?\+ ?2|quantum computing/,
								);
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
