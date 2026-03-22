import scenario from "@langwatch/scenario";
import fs from "fs";
import { execSync } from "child_process";
import { describe, it, expect } from "vitest";
import dotenv from "dotenv";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { openai } from "@ai-sdk/openai";
import { createAgent, getRunner, isRunnerAvailable } from "./helpers/agent-factory";
import { toolCallFix } from "./helpers/shared";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, "../.env") });

const isCI = !!process.env.CI;
const runner = getRunner();
const runnerUnavailable = !isRunnerAvailable();

const judgeModel = openai("gpt-5-mini");

const skillPath = path.resolve(__dirname, "../level-up/SKILL.md");

describe("Level-up Skill", () => {
  it.skipIf(isCI || runnerUnavailable)(
    "orchestrates all sub-skills for a Python OpenAI bot",
    async () => {
      const tempFolder = fs.mkdtempSync(
        path.join(os.tmpdir(), "langwatch-skill-level-up-py-")
      );

      execSync(
        `cp -r ${path.resolve(__dirname, "fixtures/python-openai")}/* ${tempFolder}/`
      );

      const result = await scenario.run({
        name: "Python OpenAI level-up",
        description:
          "Taking a Python OpenAI bot to the next level with full LangWatch integration.",
        agents: [
          createAgent({ workingDirectory: tempFolder, skillPath }),
          scenario.userSimulatorAgent({ model: judgeModel }),
          scenario.judgeAgent({
            model: judgeModel,
            criteria: [
              "Agent should have added LangWatch tracing to the code",
              "Agent should have set up some form of evaluation or experiment",
              "Agent should have used the LangWatch MCP to check documentation",
            ],
          }),
        ],
        script: [
          scenario.user(
            "take my agent to the next level with langwatch — add tracing, set up evaluations, and add scenario tests. Be concise, no need to run anything."
          ),
          scenario.agent(),
          (state) => {
            toolCallFix(state);
            // Verify tracing was added
            const mainPy = fs.readFileSync(
              `${tempFolder}/main.py`,
              "utf8"
            );
            expect(mainPy).toContain("langwatch");
          },
          scenario.judge(),
        ],
      });

      expect(result.success).toBe(true);
    },
    900_000 // 15 min timeout for meta-skill
  );

  it.skipIf(isCI || runnerUnavailable)(
    "orchestrates all sub-skills for a TypeScript Vercel AI bot",
    async () => {
      const tempFolder = fs.mkdtempSync(
        path.join(os.tmpdir(), "langwatch-skill-level-up-ts-")
      );
      execSync(
        `cp -r ${path.resolve(__dirname, "fixtures/typescript-vercel")}/* ${tempFolder}/`
      );

      const result = await scenario.run({
        name: "TypeScript Vercel AI level-up",
        description:
          "Taking a TypeScript Vercel AI bot to the next level with full LangWatch integration.",
        agents: [
          createAgent({ workingDirectory: tempFolder, skillPath }),
          scenario.userSimulatorAgent({ model: judgeModel }),
          scenario.judgeAgent({
            model: judgeModel,
            criteria: [
              "Agent should have added LangWatch tracing to the code",
              "Agent should have set up some form of evaluation or testing",
              "Agent should have used the LangWatch MCP to check documentation",
            ],
          }),
        ],
        script: [
          scenario.user(
            "take my agent to the next level with langwatch — add tracing, set up evaluations, and add scenario tests. Be concise, no need to run anything."
          ),
          scenario.agent(),
          (state) => {
            toolCallFix(state);
            const indexTs = fs.readFileSync(
              `${tempFolder}/index.ts`,
              "utf8"
            );
            expect(indexTs).toContain("langwatch");
          },
          scenario.judge(),
        ],
      });
      expect(result.success).toBe(true);
    },
    900_000
  );

  it.skipIf(isCI || runnerUnavailable)(
    "orchestrates all sub-skills for a Python LangGraph agent",
    async () => {
      const tempFolder = fs.mkdtempSync(
        path.join(os.tmpdir(), "langwatch-skill-level-up-langgraph-")
      );
      execSync(
        `cp -r ${path.resolve(__dirname, "fixtures/python-langgraph")}/* ${tempFolder}/`
      );

      const result = await scenario.run({
        name: "Python LangGraph level-up",
        description:
          "Taking a Python LangGraph agent to the next level with full LangWatch integration.",
        agents: [
          createAgent({ workingDirectory: tempFolder, skillPath }),
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
            "take my agent to the next level with langwatch — add tracing, set up evaluations, and add scenario tests. Be concise, no need to run anything."
          ),
          scenario.agent(),
          (state) => {
            toolCallFix(state);
            const mainPy = fs.readFileSync(
              `${tempFolder}/main.py`,
              "utf8"
            );
            expect(mainPy).toContain("langwatch");
          },
          scenario.judge(),
        ],
      });
      expect(result.success).toBe(true);
    },
    900_000
  );

  it.skipIf(isCI || runnerUnavailable)(
    "orchestrates all sub-skills for a TypeScript Mastra agent",
    async () => {
      const tempFolder = fs.mkdtempSync(
        path.join(os.tmpdir(), "langwatch-skill-level-up-mastra-")
      );
      execSync(
        `cp -r ${path.resolve(__dirname, "fixtures/typescript-mastra")}/* ${tempFolder}/`
      );

      const result = await scenario.run({
        name: "TypeScript Mastra level-up",
        description:
          "Taking a TypeScript Mastra agent to the next level with full LangWatch integration.",
        agents: [
          createAgent({ workingDirectory: tempFolder, skillPath }),
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
            "take my agent to the next level with langwatch — add tracing, set up evaluations, and add scenario tests. Be concise, no need to run anything."
          ),
          scenario.agent(),
          (state) => {
            toolCallFix(state);
            const indexTs = fs.readFileSync(
              `${tempFolder}/index.ts`,
              "utf8"
            );
            expect(indexTs).toContain("langwatch");
          },
          scenario.judge(),
        ],
      });
      expect(result.success).toBe(true);
    },
    900_000
  );
});
