import scenario from "@langwatch/scenario";
import fs from "fs";
import { describe, it, expect } from "vitest";
import dotenv from "dotenv";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { openai } from "@ai-sdk/openai";
import {
  copyFixtureToWorkDir,
  createClaudeCodeAgent,
  toolCallFix,
  assertSkillWasRead,
  installSkillToWorkDir,
  SKILL_TESTS_SET_ID,
} from "./helpers/claude-code-adapter";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, "../.env") });

const isCI = !!process.env.CI;

const judgeModel = openai("gpt-5-mini");

function copySkillToWorkDir(tempFolder: string) {
  installSkillToWorkDir({ workingDirectory: tempFolder, skillSubpath: "level-up" });
}

/**
 * Asserts that the instrumentation reached the source of the agent.
 *
 * Reads every source file of the workspace rather than the entry file alone.
 * The agent is free to move the model calls into a module of its own, which
 * several runs do, and the tracing then correctly sits next to the calls
 * instead of in the entry file.
 */
function expectTracingInSource(tempFolder: string, extension: string) {
  const sources = fs
    .readdirSync(tempFolder, { recursive: true, withFileTypes: true })
    .filter(
      (entry) =>
        entry.isFile() &&
        entry.name.endsWith(extension) &&
        !`${entry.parentPath}`.includes("node_modules") &&
        !`${entry.parentPath}`.includes(".skills"),
    )
    .map((entry) => path.join(`${entry.parentPath}`, entry.name));

  const instrumented = sources.filter((file) =>
    fs.readFileSync(file, "utf8").includes("langwatch"),
  );

  expect(
    instrumented,
    `Expected a ${extension} file under ${tempFolder} to carry LangWatch tracing. Read: ${sources.join(", ")}`,
  ).not.toHaveLength(0);
}

describe("Level-up Skill", () => {
  it.skipIf(isCI)(
    "orchestrates all sub-skills for a Python OpenAI bot",
    async () => {
      const tempFolder = fs.mkdtempSync(
        path.join(os.tmpdir(), "langwatch-skill-level-up-py-")
      );

      copyFixtureToWorkDir({
        fixtureSubpath: "python-openai",
        workingDirectory: tempFolder,
      });
      copySkillToWorkDir(tempFolder);

      const result = await scenario.run({
        setId: SKILL_TESTS_SET_ID,
        name: "Python OpenAI level-up",
        description:
          "Taking a Python OpenAI bot to the next level with full LangWatch integration.",
        agents: [
          createClaudeCodeAgent({ workingDirectory: tempFolder }),
          scenario.userSimulatorAgent({ model: judgeModel }),
          scenario.judgeAgent({
            model: judgeModel,
            criteria: [
              "Agent should have added LangWatch tracing to the code",
              "Agent should have set up some form of evaluation or experiment",
              "Agent should have used the `langwatch docs` and/or `langwatch scenario-docs` CLI commands to read documentation",
            ],
          }),
        ],
        script: [
          scenario.user(
            "take my agent to the next level with langwatch — add tracing, set up evaluations, and add scenario tests"
          ),
          scenario.agent(),
          (state) => {
            toolCallFix(state);
            assertSkillWasRead(state, "level-up");
            // Verify tracing was added
            expectTracingInSource(tempFolder, ".py");
          },
          scenario.judge(),
        ],
      });

      expect(result.success).toBe(true);
    },
    1_800_000 // 30 min: the meta-skill runs every sub-skill in one turn
  );

  it.skipIf(isCI)(
    "orchestrates all sub-skills for a TypeScript Vercel AI bot",
    async () => {
      const tempFolder = fs.mkdtempSync(
        path.join(os.tmpdir(), "langwatch-skill-level-up-ts-")
      );
      copyFixtureToWorkDir({
        fixtureSubpath: "typescript-vercel",
        workingDirectory: tempFolder,
      });
      copySkillToWorkDir(tempFolder);

      const result = await scenario.run({
        setId: SKILL_TESTS_SET_ID,
        name: "TypeScript Vercel AI level-up",
        description:
          "Taking a TypeScript Vercel AI bot to the next level with full LangWatch integration.",
        agents: [
          createClaudeCodeAgent({ workingDirectory: tempFolder }),
          scenario.userSimulatorAgent({ model: judgeModel }),
          scenario.judgeAgent({
            model: judgeModel,
            criteria: [
              "Agent should have added LangWatch tracing to the code",
              "Agent should have set up some form of evaluation or testing",
              "Agent should have used the `langwatch docs` and/or `langwatch scenario-docs` CLI commands to read documentation",
            ],
          }),
        ],
        script: [
          scenario.user(
            "take my agent to the next level with langwatch — add tracing, set up evaluations, and add scenario tests"
          ),
          scenario.agent(),
          (state) => {
            toolCallFix(state);
            assertSkillWasRead(state, "level-up");
            expectTracingInSource(tempFolder, ".ts");
          },
          scenario.judge(),
        ],
      });
      expect(result.success).toBe(true);
    },
    1_800_000
  );

  it.skipIf(isCI)(
    "orchestrates all sub-skills for a Python LangGraph agent",
    async () => {
      const tempFolder = fs.mkdtempSync(
        path.join(os.tmpdir(), "langwatch-skill-level-up-langgraph-")
      );
      copyFixtureToWorkDir({
        fixtureSubpath: "python-langgraph",
        workingDirectory: tempFolder,
      });
      copySkillToWorkDir(tempFolder);

      const result = await scenario.run({
        setId: SKILL_TESTS_SET_ID,
        name: "Python LangGraph level-up",
        description:
          "Taking a Python LangGraph agent to the next level with full LangWatch integration.",
        agents: [
          createClaudeCodeAgent({ workingDirectory: tempFolder }),
          scenario.userSimulatorAgent({ model: judgeModel }),
          scenario.judgeAgent({
            model: judgeModel,
            criteria: [
              "Agent should have added LangWatch tracing",
              "Agent should have set up some form of evaluation or testing",
            ],
          }),
        ],
        script: [
          scenario.user(
            "take my agent to the next level with langwatch — add tracing, set up evaluations, and add scenario tests"
          ),
          scenario.agent(),
          (state) => {
            toolCallFix(state);
            assertSkillWasRead(state, "level-up");
            expectTracingInSource(tempFolder, ".py");
          },
          scenario.judge(),
        ],
      });
      expect(result.success).toBe(true);
    },
    1_800_000
  );

  it.skipIf(isCI)(
    "orchestrates all sub-skills for a TypeScript Mastra agent",
    async () => {
      const tempFolder = fs.mkdtempSync(
        path.join(os.tmpdir(), "langwatch-skill-level-up-mastra-")
      );
      copyFixtureToWorkDir({
        fixtureSubpath: "typescript-mastra",
        workingDirectory: tempFolder,
      });
      copySkillToWorkDir(tempFolder);

      const result = await scenario.run({
        setId: SKILL_TESTS_SET_ID,
        name: "TypeScript Mastra level-up",
        description:
          "Taking a TypeScript Mastra agent to the next level with full LangWatch integration.",
        agents: [
          createClaudeCodeAgent({ workingDirectory: tempFolder }),
          scenario.userSimulatorAgent({ model: judgeModel }),
          scenario.judgeAgent({
            model: judgeModel,
            criteria: [
              "Agent should have added LangWatch tracing",
              "Agent should have set up some form of evaluation or testing",
            ],
          }),
        ],
        script: [
          scenario.user(
            "take my agent to the next level with langwatch — add tracing, set up evaluations, and add scenario tests"
          ),
          scenario.agent(),
          (state) => {
            toolCallFix(state);
            assertSkillWasRead(state, "level-up");
            expectTracingInSource(tempFolder, ".ts");
          },
          scenario.judge(),
        ],
      });
      expect(result.success).toBe(true);
    },
    1_800_000
  );
});
