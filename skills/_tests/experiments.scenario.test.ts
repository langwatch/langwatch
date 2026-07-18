import { createGoogleGenerativeAI } from "@ai-sdk/google";
import scenario from "@langwatch/scenario";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";
import {
	assertSkillWasRead,
	copyFixtureToWorkDir,
	createClaudeCodeAgent,
	createSkillTestWorkDir,
	installSkillToWorkDir,
	SKILL_TESTS_SET_ID,
	toolCallFix,
} from "./helpers/claude-code-adapter";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, "../.env") });

const isCI = !!process.env.CI;

const google = createGoogleGenerativeAI({ apiKey: process.env.GEMINI_API_KEY });
const judgeModel = google("gemini-2.5-flash-lite");

interface ExperimentSummary {
	name: string | null;
	runsCount: number;
}

function getProjectApiDetails(): {
	endpoint: string;
	headers: Record<string, string>;
} {
	const apiKey = process.env.LANGWATCH_API_KEY;
	if (!apiKey) {
		throw new Error("LANGWATCH_API_KEY is required for this scenario test");
	}

	const endpoint = (
		process.env.LANGWATCH_ENDPOINT ?? "https://app.langwatch.ai"
	).replace(/\/+$/, "");
	const projectId = process.env.LANGWATCH_PROJECT_ID;
	const keyBody = apiKey.slice("sk-lw-".length);
	const isUserScoped = apiKey.startsWith("pat-lw-") || keyBody.includes("_");

	if (isUserScoped && projectId) {
		const basic = Buffer.from(`${projectId}:${apiKey}`, "utf8").toString(
			"base64",
		);
		return { endpoint, headers: { authorization: `Basic ${basic}` } };
	}

	return {
		endpoint,
		headers: {
			authorization: `Bearer ${apiKey}`,
			"x-auth-token": apiKey,
		},
	};
}

async function listRealExperiments(): Promise<ExperimentSummary[]> {
	const { endpoint, headers } = getProjectApiDetails();
	const response = await fetch(`${endpoint}/api/experiments?pageSize=200`, {
		headers,
	});
	if (!response.ok) {
		throw new Error(
			`Unable to list real experiments: ${response.status} ${await response.text()}`,
		);
	}
	const body = (await response.json()) as {
		experiments: ExperimentSummary[];
	};
	return body.experiments;
}

function executedCommandTranscript(state: {
	messages: Array<{ content: unknown }>;
}): string {
	return state.messages
		.map((message) =>
			typeof message.content === "string"
				? message.content
				: JSON.stringify(message.content ?? ""),
		)
		.join("\n")
		.replace(/\\/g, "");
}

function copySkillToWorkDir(tempFolder: string) {
	installSkillToWorkDir({
		workingDirectory: tempFolder,
		skillSubpath: "experiments",
	});
}

function findNewPythonFiles(
	dir: string,
	excludeNames: string[] = ["main.py"],
): string[] {
	const results: string[] = [];
	if (!fs.existsSync(dir)) return results;

	for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
		const fullPath = path.join(dir, entry.name);
		if (
			entry.isDirectory() &&
			!entry.name.startsWith(".") &&
			entry.name !== "node_modules" &&
			entry.name !== ".venv"
		) {
			results.push(...findNewPythonFiles(fullPath, []));
		} else if (
			entry.isFile() &&
			!excludeNames.includes(entry.name) &&
			(/\.ipynb$/.test(entry.name) || /\.py$/.test(entry.name))
		) {
			results.push(fullPath);
		}
	}
	return results;
}

describe("Experiments Skill", () => {
	it.skipIf(isCI)(
		"creates an evaluation experiment for a Python OpenAI bot",
		async () => {
			const tempFolder = createSkillTestWorkDir(
				"langwatch-skill-experiment-py-",
			);

			copyFixtureToWorkDir({
				fixtureSubpath: "python-openai",
				workingDirectory: tempFolder,
			});
			copySkillToWorkDir(tempFolder);
			const experimentName = "Skill dogfood tweet experiment";

			const result = await scenario.run({
				setId: SKILL_TESTS_SET_ID,
				name: "Python OpenAI evaluation experiment",
				description:
					"Creating an evaluation experiment for a Python OpenAI chatbot that replies with tweet-like responses and emojis.",
				agents: [
					createClaudeCodeAgent({
						workingDirectory: tempFolder,
						omitEnvKeys: ["ANTHROPIC_API_KEY", "GEMINI_API_KEY"],
					}),
					scenario.userSimulatorAgent({ model: judgeModel }),
					scenario.judgeAgent({
						model: judgeModel,
						criteria: [
							"Agent created an evaluation experiment file (notebook or script)",
							"Agent generated a dataset that is specific to the agent's domain. For this tweet-like emoji bot, the dataset should contain inputs that real users would send to this bot, NOT generic trivia like 'What is 2+2?' or 'Capital of France'",
							`Agent actually ran a real LangWatch experiment named '${experimentName}' and verified it through the LangWatch experiment CLI`,
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

						const newFiles = findNewPythonFiles(tempFolder);
						expect(
							newFiles.length,
							`Expected at least one new .py or .ipynb file created in ${tempFolder}`,
						).toBeGreaterThan(0);

						const fileContents = newFiles
							.map((f) => fs.readFileSync(f, "utf8"))
							.join("\n")
							.toLowerCase();

						expect(fileContents).toContain("langwatch");

						// Verify the dataset is NOT generic and should NOT have trivia-style examples
						expect(
							fileContents,
							"Dataset should not contain generic trivia like 'capital of france'. It should be specific to the tweet-like emoji bot",
						).not.toMatch(
							/capital of france|what is 2 ?\+ ?2|quantum computing|photosynthesis/,
						);
					},
					scenario.judge(),
				],
			});

			expect(result.success).toBe(true);
			const savedExperiment = (await listRealExperiments()).find(
				(experiment) => experiment.name === experimentName,
			);
			expect(savedExperiment).toBeDefined();
			expect(savedExperiment!.runsCount).toBeGreaterThan(0);
		},
		900_000,
	);

	it.skipIf(isCI)(
		"creates an evaluation experiment for a TypeScript Vercel AI bot",
		async () => {
			const tempFolder = createSkillTestWorkDir(
				"langwatch-skill-experiments-ts-",
			);

			copyFixtureToWorkDir({
				fixtureSubpath: "typescript-vercel",
				workingDirectory: tempFolder,
			});
			copySkillToWorkDir(tempFolder);

			const result = await scenario.run({
				setId: SKILL_TESTS_SET_ID,
				name: "TypeScript Vercel AI evaluation experiment",
				description:
					"Creating an evaluation experiment for a TypeScript Vercel AI chatbot.",
				agents: [
					createClaudeCodeAgent({
						workingDirectory: tempFolder,
						omitEnvKeys: ["ANTHROPIC_API_KEY", "GEMINI_API_KEY"],
					}),
					scenario.userSimulatorAgent({ model: judgeModel }),
					scenario.judgeAgent({
						model: judgeModel,
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
						// Find new TypeScript files (not index.ts)
						const files = fs
							.readdirSync(tempFolder)
							.filter((f) => f.endsWith(".ts") && f !== "index.ts");
						expect(
							files.length,
							"Expected at least one new .ts file",
						).toBeGreaterThan(0);
						const content = files
							.map((f) => fs.readFileSync(path.join(tempFolder, f), "utf8"))
							.join("\n");
						expect(content).toContain("langwatch");
					},
					scenario.judge(),
				],
			});

			expect(result.success).toBe(true);
		},
		900_000,
	);

	it.skipIf(isCI)(
		"creates an evaluation experiment for a Python LangGraph agent",
		async () => {
			const tempFolder = createSkillTestWorkDir(
				"langwatch-skill-experiments-langgraph-",
			);
			copyFixtureToWorkDir({
				fixtureSubpath: "python-langgraph",
				workingDirectory: tempFolder,
			});
			copySkillToWorkDir(tempFolder);

			const result = await scenario.run({
				setId: SKILL_TESTS_SET_ID,
				name: "Python LangGraph evaluation experiment",
				description:
					"Creating an evaluation experiment for a Python LangGraph agent.",
				agents: [
					createClaudeCodeAgent({
						workingDirectory: tempFolder,
						omitEnvKeys: ["ANTHROPIC_API_KEY", "GEMINI_API_KEY"],
					}),
					scenario.userSimulatorAgent({ model: judgeModel }),
					scenario.judgeAgent({
						model: judgeModel,
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
						const newFiles = findNewPythonFiles(tempFolder);
						expect(
							newFiles.length,
							"Expected at least one new .py file",
						).toBeGreaterThan(0);
						const content = newFiles
							.map((f) => fs.readFileSync(f, "utf8"))
							.join("\n");
						expect(content).toContain("langwatch");
					},
					scenario.judge(),
				],
			});
			expect(result.success).toBe(true);
		},
		900_000,
	);

	it.skipIf(isCI)(
		"creates a targeted evaluation for RAG faithfulness",
		async () => {
			const tempFolder = createSkillTestWorkDir(
				"langwatch-skill-experiments-targeted-",
			);
			copyFixtureToWorkDir({
				fixtureSubpath: "python-openai",
				workingDirectory: tempFolder,
			});
			copySkillToWorkDir(tempFolder);

			const result = await scenario.run({
				setId: SKILL_TESTS_SET_ID,
				name: "Targeted RAG faithfulness evaluation",
				description:
					"Adding a specific evaluation for checking if the agent's responses are faithful to the context provided.",
				agents: [
					createClaudeCodeAgent({
						workingDirectory: tempFolder,
						omitEnvKeys: ["ANTHROPIC_API_KEY", "GEMINI_API_KEY"],
					}),
					scenario.userSimulatorAgent({ model: judgeModel }),
					scenario.judgeAgent({
						model: judgeModel,
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
						const newFiles = findNewPythonFiles(tempFolder);
						expect(newFiles.length).toBeGreaterThan(0);
						const content = newFiles
							.map((f) => fs.readFileSync(f, "utf8"))
							.join("\n");
						expect(content).toContain("langwatch");
					},
					scenario.judge(),
				],
			});
			expect(result.success).toBe(true);
		},
		900_000,
	);

	it.skipIf(isCI)(
		"creates domain-specific evaluation for a RAG agent",
		async () => {
			const tempFolder = createSkillTestWorkDir(
				"langwatch-skill-experiments-rag-",
			);
			copyFixtureToWorkDir({
				fixtureSubpath: "python-rag-agent",
				workingDirectory: tempFolder,
			});
			copySkillToWorkDir(tempFolder);

			const result = await scenario.run({
				setId: SKILL_TESTS_SET_ID,
				name: "RAG agent domain-specific evaluation",
				description:
					"Creating an evaluation experiment for a TerraVerde farm advisory RAG agent.",
				agents: [
					createClaudeCodeAgent({
						workingDirectory: tempFolder,
						omitEnvKeys: ["ANTHROPIC_API_KEY", "GEMINI_API_KEY"],
					}),
					scenario.userSimulatorAgent({ model: judgeModel }),
					scenario.judgeAgent({
						model: judgeModel,
						criteria: [
							"Agent created an evaluation experiment with domain-specific data about agriculture, irrigation, frost protection, or pest management",
							"Dataset does NOT contain generic trivia. It has realistic agronomic questions",
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
						const newFiles = findNewPythonFiles(tempFolder);
						expect(newFiles.length).toBeGreaterThan(0);
						const content = newFiles
							.map((f) => fs.readFileSync(f, "utf8"))
							.join("\n")
							.toLowerCase();
						expect(content).toContain("langwatch");

						// Verify domain specificity
						const hasDomainTerms =
							content.includes("irrigation") ||
							content.includes("frost") ||
							content.includes("pest") ||
							content.includes("soil") ||
							content.includes("crop");
						expect(
							hasDomainTerms,
							"Expected dataset to contain agricultural domain terms",
						).toBe(true);

						expect(content).not.toMatch(
							/capital of france|what is 2 ?\+ ?2|quantum computing/,
						);
					},
					scenario.judge(),
				],
			});
			expect(result.success).toBe(true);
		},
		900_000,
	);
});
