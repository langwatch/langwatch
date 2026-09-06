import {
	type AgentAdapter,
	claudeCodeAgent,
	pointClaudeMdAtSkills,
} from "@langwatch/scenario";
import chalk from "chalk";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { inlineMdx } from "../../_lib/mdx-inline.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Scenario set ID for all skill scenario tests. Keeps these runs grouped together
 * in the LangWatch UI and separate from the `default` set, where scenarios that
 * the skills themselves create at runtime end up.
 */
export const SKILL_TESTS_SET_ID = "skill-tests";

/**
 * How long one Claude Code turn may take. A skill run installs dependencies,
 * writes tests and runs them, so a turn is measured in minutes, not the two
 * the SDK defaults to. Matches the vitest test timeout.
 */
const CLAUDE_TURN_TIMEOUT_MS = 60 * 60 * 1000;

const skillTestWorkRoot = path.resolve(
	__dirname,
	"../../../.claude/tmp/skill-tests",
);

export function createSkillTestWorkDir(prefix: string): string {
	fs.mkdirSync(skillTestWorkRoot, { recursive: true });
	return fs.mkdtempSync(path.join(skillTestWorkRoot, prefix));
}

export function removeSkillTestWorkDir(workingDirectory: string): void {
	const resolvedDirectory = path.resolve(workingDirectory);
	if (!resolvedDirectory.startsWith(`${skillTestWorkRoot}${path.sep}`)) {
		throw new Error(`Test workspace must stay inside ${skillTestWorkRoot}`);
	}
	if (process.env.KEEP_SKILL_TEST_WORKDIR === "1") {
		console.log(`[skill dogfood] preserved workdir: ${resolvedDirectory}`);
		return;
	}

	fs.rmSync(resolvedDirectory, { recursive: true, force: true });
}

export function copyFixtureToWorkDir({
	fixtureSubpath,
	workingDirectory,
}: {
	fixtureSubpath: string;
	workingDirectory: string;
}): void {
	const fixtureRoot = path.resolve(__dirname, "../fixtures");
	const sourcePath = path.resolve(fixtureRoot, fixtureSubpath);
	if (!sourcePath.startsWith(`${fixtureRoot}${path.sep}`)) {
		throw new Error(`Fixture path must stay inside ${fixtureRoot}`);
	}

	fs.cpSync(sourcePath, workingDirectory, { recursive: true });
}

/**
 * Inline a SKILL.mdx (resolving its `_shared/*.mdx` imports) and write it as
 * SKILL.md into a `.skills/<dir>/` folder under the agent's working directory.
 * `skillSubpath` is relative to `skills/`, e.g. `"tracing"` or
 * `"recipes/debug-instrumentation"`. `installAs` defaults to the basename of
 * `skillSubpath` and controls the directory the agent sees under `.skills/`.
 *
 * This mirrors what sync.ts does for langwatch/skills publishes, so scenario
 * tests exercise the same self-contained markdown that real consumers receive.
 */
export function installSkillToWorkDir({
	workingDirectory,
	skillSubpath,
	installAs,
}: {
	workingDirectory: string;
	skillSubpath: string;
	installAs?: string;
}): void {
	const sourcePath = path.resolve(
		__dirname,
		"../..",
		skillSubpath,
		"SKILL.mdx",
	);
	const skillName = installAs ?? path.basename(skillSubpath);
	const skillDir = path.join(workingDirectory, ".skills", skillName);
	fs.mkdirSync(skillDir, { recursive: true });
	fs.writeFileSync(path.join(skillDir, "SKILL.md"), inlineMdx(sourcePath));
}

const cliDistPath = path.resolve(
	__dirname,
	"../../../sdks/typescript/dist/cli/index.js",
);

/**
 * Sets up a local `langwatch` CLI wrapper in the temp folder's bin/ directory.
 * Always called from createClaudeCodeAgent so the spawned Claude Code session
 * sees the locally-built CLI (with `docs`, `scenario-docs`, etc.) on PATH
 * instead of any globally-installed npm version. Skill scenario tests rely on
 * the new CLI commands being available. This is non-optional.
 */
export function setupLocalCli(workingDirectory: string): void {
	if (!fs.existsSync(cliDistPath)) {
		throw new Error(
			`Local langwatch CLI not built at ${cliDistPath}. ` +
				`Run \`pnpm build\` inside sdks/typescript/ before running scenario tests.`,
		);
	}

	const binDir = path.join(workingDirectory, "bin");
	fs.mkdirSync(binDir, { recursive: true });

	const wrapperScript = `#!/usr/bin/env bash
exec node "${cliDistPath}" "$@"
`;
	const wrapperPath = path.join(binDir, "langwatch");
	fs.writeFileSync(wrapperPath, wrapperScript, { mode: 0o755 });
}

/**
 * Creates the Claude Code agent under test, the `claudeCodeAgent` of
 * `@langwatch/scenario` configured for skill testing.
 *
 * Skills are CLI-only, and the locally built `langwatch` CLI is always wired
 * onto PATH so the agent can use `langwatch docs`, `langwatch scenario-docs`,
 * and every platform command. No MCP server is configured; skills must work
 * end-to-end through the CLI. The turn comes back as AI SDK messages with
 * `tool-call` and `tool-result` parts, so the judge reads what the agent ran
 * and the run view renders it as tool calls. The SDK keeps the spawned Claude
 * in its own process group and kills it, with everything it started, when
 * the test process dies, so an interrupted run leaves no Claude behind.
 *
 * @param workingDirectory - The directory to run Claude Code in
 * @param skillPath - Optional path to a SKILL.md to copy into the working directory
 * @param cleanEnv - When true, strips LANGWATCH_API_KEY, OPENAI_API_KEY, and
 *   ANTHROPIC_API_KEY from the spawned process environment. Use this to test
 *   cold-start flows where the agent must discover keys from .env files.
 * @param omitEnvKeys - Additional variables to keep in the test process but
 *   remove from Claude Code, such as a provider key used only by the judge.
 * @param extraEnv - Variables to add to the spawned Claude Code process,
 *   such as LANGWATCH_CLI_CONFIG, which points the CLI at its own config
 *   file so the `langwatch login` of the developer machine never reaches
 *   a scenario that must start with no credential at all.
 */
export function createClaudeCodeAgent({
	workingDirectory,
	skillPath,
	cleanEnv,
	omitEnvKeys = [],
	extraEnv = {},
}: {
	workingDirectory: string;
	skillPath?: string;
	cleanEnv?: boolean;
	omitEnvKeys?: string[];
	extraEnv?: Record<string, string>;
}): AgentAdapter {
	setupLocalCli(workingDirectory);

	// The batch of the harness is not the batch of the agent. Several skills
	// tell the agent to write scenario tests and run them, and those runs would
	// otherwise join the batch this suite reports under and read as results of
	// the suite itself.
	const removedKeys = ["SCENARIO_BATCH_RUN_ID", ...omitEnvKeys];
	if (cleanEnv) {
		removedKeys.push("LANGWATCH_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY");
	}

	const agent = claudeCodeAgent({
		workingDirectory,
		skillPath,
		// Pin the model. The user's default in ~/.claude/settings.json can be
		// a more expensive tier, and these tests run many sub Claudes.
		model: "opus",
		skipPermissions: true,
		output: "messages",
		timeout: CLAUDE_TURN_TIMEOUT_MS,
		env: {
			...Object.fromEntries(removedKeys.map((key) => [key, undefined])),
			...extraEnv,
			// The local bin/ wrapper first, so Claude uses the locally-built
			// `langwatch` CLI with the latest commands.
			PATH: `${path.join(workingDirectory, "bin")}:${process.env.PATH ?? ""}`,
		},
		logger: {
			log: (message) => console.log(chalk.cyan("Claude Code:"), message),
			warn: (message) => console.log(chalk.yellow("Claude Code:"), message),
		},
	});

	// The skills a test installed with installSkillToWorkDir are not the one
	// skillPath injects, and Claude Code does not discover .skills/ on its own.
	pointClaudeMdAtSkills(workingDirectory);

	return agent;
}
