import { createGoogleGenerativeAI } from "@ai-sdk/google";
import scenario, { type ScenarioExecutionStateLike } from "@langwatch/scenario";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { describe, expect, it } from "vitest";
import {
	assertSkillWasRead,
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

interface Monitor {
	id: string;
	name: string;
	checkType: string;
	enabled: boolean;
	executionMode: string;
	sample: number;
	level?: string;
}

function getApiDetails(): {
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

async function listMonitors(): Promise<Monitor[]> {
	const { endpoint, headers } = getApiDetails();
	const response = await fetch(`${endpoint}/api/monitors`, { headers });
	if (!response.ok) {
		throw new Error(
			`Unable to list real monitors: ${response.status} ${await response.text()}`,
		);
	}
	return (await response.json()) as Monitor[];
}

async function getMonitor(id: string): Promise<Monitor> {
	const { endpoint, headers } = getApiDetails();
	const response = await fetch(`${endpoint}/api/monitors/${id}`, { headers });
	if (!response.ok) {
		throw new Error(
			`Unable to read real monitor ${id}: ${response.status} ${await response.text()}`,
		);
	}
	return (await response.json()) as Monitor;
}

async function deleteMonitor(id: string): Promise<void> {
	const { endpoint, headers } = getApiDetails();
	const response = await fetch(`${endpoint}/api/monitors/${id}`, {
		method: "DELETE",
		headers,
	});
	if (!response.ok && response.status !== 404) {
		throw new Error(
			`Unable to clean up real monitor ${id}: ${response.status} ${await response.text()}`,
		);
	}
}

function executedCommandTranscript(state: ScenarioExecutionStateLike): string {
	return state.messages
		.map((message) =>
			typeof message.content === "string"
				? message.content
				: JSON.stringify(message.content ?? ""),
		)
		.join("\n")
		.replace(/\\/g, "");
}

describe("Online Evaluations Skill", () => {
	it.skipIf(isCI)(
		"creates and verifies a real asynchronous online evaluation",
		async () => {
			const tempFolder = createSkillTestWorkDir(
				"langwatch-skill-online-evaluation-",
			);
			installSkillToWorkDir({
				workingDirectory: tempFolder,
				skillSubpath: "online-evaluations",
			});

			const monitorName = `Skill dogfood online evaluation ${Date.now()}`;

			try {
				const result = await scenario.run({
					setId: SKILL_TESTS_SET_ID,
					name: "Create and verify a real online evaluation",
					description:
						"The agent must use the focused online-evaluations skill and the real LangWatch CLI to create an asynchronous production monitor, then verify the saved resource.",
					agents: [
						createClaudeCodeAgent({
							workingDirectory: tempFolder,
							omitEnvKeys: ["ANTHROPIC_API_KEY", "GEMINI_API_KEY"],
						}),
						scenario.userSimulatorAgent({ model: judgeModel }),
						scenario.judgeAgent({
							model: judgeModel,
							criteria: [
								"Agent used the LangWatch monitor CLI rather than creating a batch experiment",
								`Agent created the monitor with the exact name '${monitorName}' using langevals/exact_match, ON_MESSAGE mode, trace level, and 25% sampling`,
								"Agent verified the saved monitor with a real monitor list or get command and reported the concrete saved configuration",
							],
						}),
					],
					script: [
						scenario.user(
							`Create a real online evaluation named "${monitorName}" for production traces. Use langevals/exact_match asynchronously in ON_MESSAGE mode, trace level, at 25% sampling. Inspect the existing setup first, create it with the langwatch CLI, then verify the exact saved monitor.`,
						),
						scenario.agent(),
						(state) => {
							const transcript = executedCommandTranscript(state);
							expect(transcript).toMatch(
								/"command":"[^"]*langwatch monitor create/,
							);
							expect(transcript).toMatch(
								/"command":"[^"]*langwatch monitor (get|list)/,
							);
							toolCallFix(state);
							assertSkillWasRead(state, "online-evaluations");
						},
						scenario.judge(),
					],
				});

				expect(result.success).toBe(true);

				const created = (await listMonitors()).find(
					(monitor) => monitor.name === monitorName,
				);
				expect(
					created,
					"expected the agent to create a real monitor",
				).toBeDefined();

				const saved = await getMonitor(created!.id);
				expect(saved).toMatchObject({
					name: monitorName,
					checkType: "langevals/exact_match",
					executionMode: "ON_MESSAGE",
					level: "trace",
					sample: 0.25,
					enabled: true,
				});
			} finally {
				const leftovers = (await listMonitors()).filter(
					(monitor) => monitor.name === monitorName,
				);
				await Promise.all(
					leftovers.map((monitor) => deleteMonitor(monitor.id)),
				);
			}
		},
		900_000,
	);

	it.skipIf(isCI)(
		"hands a batch benchmark to the experiments skill",
		async () => {
			const tempFolder = createSkillTestWorkDir(
				"langwatch-skill-online-to-experiments-",
			);
			installSkillToWorkDir({
				workingDirectory: tempFolder,
				skillSubpath: "online-evaluations",
			});

			const result = await scenario.run({
				setId: SKILL_TESTS_SET_ID,
				name: "Online evaluation skill routes a batch request",
				description:
					"A batch benchmark request reaches the online-evaluations skill. It must hand off to the experiments skill instead of mixing workflows.",
				agents: [
					createClaudeCodeAgent({
						workingDirectory: tempFolder,
						omitEnvKeys: ["ANTHROPIC_API_KEY", "GEMINI_API_KEY"],
					}),
					scenario.userSimulatorAgent({ model: judgeModel }),
					scenario.judgeAgent({
						model: judgeModel,
						criteria: [
							"Agent clearly says this batch benchmark belongs to the experiments workflow",
							"Agent gives the exact install command `npx skills add langwatch/skills/experiments` because that companion skill is unavailable",
							"Agent does not create an online monitor or guardrail",
						],
					}),
				],
				script: [
					scenario.user(
						"Benchmark two prompt versions over a fixed dataset before release. The companion experiments skill is not installed. Do not install anything, fetch repositories, or create resources yet. Tell me which focused skill I need and give me its exact install command.",
					),
					scenario.agent(),
					(state) => {
						const transcript = executedCommandTranscript(state);
						expect(transcript).not.toMatch(
							/"command":"[^"]*langwatch monitor create/,
						);
						toolCallFix(state);
						assertSkillWasRead(state, "online-evaluations");
					},
					scenario.judge(),
				],
			});

			expect(result.success).toBe(true);
		},
		900_000,
	);
});
