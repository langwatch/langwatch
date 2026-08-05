import scenario from "@langwatch/scenario";
import { describe, expect, it } from "vitest";

import {
	assertSkillWasRead,
	createClaudeCodeAgent,
	SKILL_TESTS_SET_ID,
	toolCallFix,
} from "./helpers/claude-code-adapter";
import {
	executedCommandTranscript,
	experimentWasCreatedOrAdvanced,
	experimentsJudgeModel,
	findFilesCreatedSince,
	isCI,
	readGeneratedFiles,
	snapshotExperimentRuns,
	snapshotGeneratedFiles,
	withExperimentWorkDir,
} from "./helpers/experiments-scenario";

describe("Experiments Skill for a Python OpenAI bot", () => {
	/**
	 * @scenario Use the experiments skill for batch testing
	 * @scenario Prove both skills independently with real services
	 */
	it.skipIf(isCI)(
		"creates and advances a real evaluation experiment",
		async () => {
			await withExperimentWorkDir({
				prefix: "langwatch-skill-experiment-py-",
				fixtureSubpath: "python-openai",
				run: async (workingDirectory) => {
					const experimentName = `Skill dogfood tweet experiment ${Date.now()}`;
					const filesBefore = snapshotGeneratedFiles({
						directory: workingDirectory,
						extensions: [".py", ".ipynb"],
					});
					const runsBefore = await snapshotExperimentRuns(experimentName);

					const result = await scenario.run({
						setId: SKILL_TESTS_SET_ID,
						name: "Python OpenAI evaluation experiment",
						description:
							"Creating an evaluation experiment for a Python OpenAI chatbot that replies with tweet-like responses and emojis.",
						agents: [
							createClaudeCodeAgent({
								workingDirectory,
								omitEnvKeys: ["ANTHROPIC_API_KEY", "OPENAI_API_KEY"],
							}),
							scenario.userSimulatorAgent({ model: experimentsJudgeModel }),
							scenario.judgeAgent({
								model: experimentsJudgeModel,
								criteria: [
									"Agent created an evaluation experiment file (notebook or script)",
									"Agent generated a dataset specific to the tweet-like emoji bot instead of generic trivia",
									`Agent ran a real LangWatch experiment named '${experimentName}' and verified it through the LangWatch experiment CLI`,
								],
							}),
						],
						script: [
							scenario.user(
								`Create and actually run a small batch experiment named "${experimentName}" for my agent using the langwatch.experiment SDK, not scenario tests. Read my agent code first, use a domain-specific dataset with two rows, keep the target deterministic so no model provider is needed, and verify the completed experiment with langwatch experiment list --format json. The inherited LANGWATCH_API_KEY already targets the correct real cloud project. Do not inspect other checkouts or credentials, replace that key, use localhost, or start a LangWatch server. You may install only the dependencies needed to run the experiment script.`,
							),
							scenario.agent(),
							(state) => {
								const transcript = executedCommandTranscript(state);
								expect(transcript).toMatch(
									/"command":"[^"]*(python|uv run|poetry run)[^"]*/,
								);
								expect(transcript).toMatch(
									/"command":"[^"]*langwatch experiment list[^"]*--format json/,
								);
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
								expect(contents).not.toMatch(
									/capital of france|what is 2 ?\+ ?2|quantum computing|photosynthesis/,
								);
							},
							scenario.judge(),
						],
					});

					expect(result.success).toBe(true);
					const runsAfter = await snapshotExperimentRuns(experimentName);
					expect(
						experimentWasCreatedOrAdvanced({
							before: runsBefore,
							after: runsAfter,
						}),
						"expected this scenario to create or advance the named experiment",
					).toBe(true);
				},
			});
		},
		900_000,
	);
});
