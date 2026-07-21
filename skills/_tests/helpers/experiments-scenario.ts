import dotenv from "dotenv";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
	copyFixtureToWorkDir,
	createSkillTestWorkDir,
	installSkillToWorkDir,
	removeSkillTestWorkDir,
} from "./claude-code-adapter";
import { createSkillJudgeModel } from "./judge-model";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

dotenv.config({ path: path.resolve(__dirname, "../../.env") });

export const isCI = !!process.env.CI;
export const experimentsJudgeModel = createSkillJudgeModel();

interface ExperimentSummary {
	id: string;
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

export async function snapshotExperimentRuns(
	name: string,
): Promise<Map<string, number>> {
	return new Map(
		(await listRealExperiments())
			.filter((experiment) => experiment.name === name)
			.map((experiment) => [experiment.id, experiment.runsCount]),
	);
}

export const experimentWasCreatedOrAdvanced = ({
	before,
	after,
}: {
	before: Map<string, number>;
	after: Map<string, number>;
}) =>
	Array.from(after).some(
		([id, runsCount]) => !before.has(id) || runsCount > (before.get(id) ?? 0),
	);

export function executedCommandTranscript(state: {
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

export async function withExperimentWorkDir<T>({
	prefix,
	fixtureSubpath,
	run,
}: {
	prefix: string;
	fixtureSubpath: string;
	run: (workingDirectory: string) => Promise<T>;
}): Promise<T> {
	const workingDirectory = createSkillTestWorkDir(prefix);
	try {
		copyFixtureToWorkDir({ fixtureSubpath, workingDirectory });
		installSkillToWorkDir({
			workingDirectory,
			skillSubpath: "experiments",
		});
		return await run(workingDirectory);
	} finally {
		removeSkillTestWorkDir(workingDirectory);
	}
}

export function findGeneratedFiles({
	directory,
	extensions,
}: {
	directory: string;
	extensions: string[];
}): string[] {
	const files: string[] = [];
	if (!fs.existsSync(directory)) return files;

	for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
		const fullPath = path.join(directory, entry.name);
		if (
			entry.isDirectory() &&
			!entry.name.startsWith(".") &&
			entry.name !== "node_modules" &&
			entry.name !== ".venv" &&
			entry.name !== "bin"
		) {
			files.push(...findGeneratedFiles({ directory: fullPath, extensions }));
		} else if (
			entry.isFile() &&
			extensions.some((extension) => entry.name.endsWith(extension))
		) {
			files.push(fullPath);
		}
	}

	return files;
}

export const snapshotGeneratedFiles = (args: {
	directory: string;
	extensions: string[];
}) => new Set(findGeneratedFiles(args));

export const findFilesCreatedSince = ({
	directory,
	extensions,
	before,
}: {
	directory: string;
	extensions: string[];
	before: Set<string>;
}) =>
	findGeneratedFiles({ directory, extensions }).filter(
		(file) => !before.has(file),
	);

export function readGeneratedFiles({
	workingDirectory,
	files,
}: {
	workingDirectory: string;
	files: string[];
}): string {
	const root = path.resolve(workingDirectory);
	return files
		.map((file) => {
			const resolvedFile = path.resolve(file);
			if (!resolvedFile.startsWith(`${root}${path.sep}`)) {
				throw new Error(`Generated file must stay inside ${root}`);
			}
			return fs.readFileSync(resolvedFile, "utf8");
		})
		.join("\n");
}
