import scenario from "@langwatch/scenario";
import fs from "fs";
import { execSync } from "child_process";
import { describe, it, expect } from "vitest";
import dotenv from "dotenv";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { openai } from "@ai-sdk/openai";
import {
  createClaudeCodeAgent,
  toolCallFix,
} from "./helpers/claude-code-adapter";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, "../.env") });

const isCI = !!process.env.CI;

const judgeModel = openai("gpt-5-mini");

function copySkillToWorkDir(tempFolder: string) {
  const skillDir = path.join(tempFolder, ".skills", "tracing");
  fs.mkdirSync(skillDir, { recursive: true });
  fs.copyFileSync(
    path.resolve(__dirname, "../tracing/SKILL.md"),
    path.join(skillDir, "SKILL.md")
  );
  const sharedDir = path.join(skillDir, "_shared");
  fs.mkdirSync(sharedDir, { recursive: true });
  execSync(
    `cp -r ${path.resolve(__dirname, "../_shared")}/* ${sharedDir}/`
  );
}

describe("Tracing Skill", () => {
  it.skipIf(isCI)(
    "instruments a Python OpenAI bot with LangWatch",
    async () => {
      const tempFolder = fs.mkdtempSync(
        path.join(os.tmpdir(), "langwatch-skill-instrument-py-")
      );

      execSync(
        `cp -r ${path.resolve(__dirname, "fixtures/python-openai")}/* ${tempFolder}/`
      );
      copySkillToWorkDir(tempFolder);

      const result = await scenario.run({
        name: "Python OpenAI instrumentation",
        description:
          "Implementing LangWatch instrumentation in a Python OpenAI bot project.",
        agents: [
          createClaudeCodeAgent({ workingDirectory: tempFolder }),
          scenario.userSimulatorAgent({ model: judgeModel }),
          scenario.judgeAgent({
            model: judgeModel,
            criteria: [
              "Agent should edit the main.py file to add LangWatch instrumentation",
              "Agent should use the LangWatch MCP to check documentation",
            ],
          }),
        ],
        script: [
          scenario.user(
            "please instrument my code with langwatch, short and sweet, no need to test the changes"
          ),
          scenario.agent(),
          (state) => {
            toolCallFix(state);
            const resultFile = fs.readFileSync(
              `${tempFolder}/main.py`,
              "utf8"
            );
            expect(resultFile).toContain("langwatch");
            expect(resultFile).toContain("trace");
          },
          scenario.judge(),
        ],
      });

      expect(result.success).toBe(true);
    },
    600_000
  );

  it.skipIf(isCI)(
    "instruments a TypeScript Vercel AI bot with LangWatch",
    async () => {
      const tempFolder = fs.mkdtempSync(
        path.join(os.tmpdir(), "langwatch-skill-instrument-ts-")
      );

      execSync(
        `cp -r ${path.resolve(__dirname, "fixtures/typescript-vercel")}/* ${tempFolder}/`
      );
      copySkillToWorkDir(tempFolder);

      const result = await scenario.run({
        name: "TypeScript Vercel AI instrumentation",
        description:
          "Implementing LangWatch instrumentation in a TypeScript Vercel AI bot project.",
        agents: [
          createClaudeCodeAgent({ workingDirectory: tempFolder }),
          scenario.userSimulatorAgent({ model: judgeModel }),
          scenario.judgeAgent({
            model: judgeModel,
            criteria: [
              "Agent should edit the TypeScript file to add LangWatch instrumentation",
              "Agent should use the LangWatch MCP to check documentation",
            ],
          }),
        ],
        script: [
          scenario.user(
            "please instrument my code with langwatch, short and sweet, no need to test the changes"
          ),
          scenario.agent(),
          (state) => {
            toolCallFix(state);
            const resultFile = fs.readFileSync(
              `${tempFolder}/index.ts`,
              "utf8"
            );
            expect(resultFile).toContain("langwatch");
          },
          scenario.judge(),
        ],
      });

      expect(result.success).toBe(true);
    },
    600_000
  );

  it.skipIf(isCI)(
    "instruments a Python LangGraph agent with LangWatch",
    async () => {
      const tempFolder = fs.mkdtempSync(
        path.join(os.tmpdir(), "langwatch-skill-tracing-langgraph-")
      );

      execSync(
        `cp -r ${path.resolve(__dirname, "fixtures/python-langgraph")}/* ${tempFolder}/`
      );
      copySkillToWorkDir(tempFolder);

      const result = await scenario.run({
        name: "Python LangGraph instrumentation",
        description:
          "Implementing LangWatch instrumentation in a Python LangGraph agent project.",
        agents: [
          createClaudeCodeAgent({ workingDirectory: tempFolder }),
          scenario.userSimulatorAgent({ model: judgeModel }),
          scenario.judgeAgent({
            model: judgeModel,
            criteria: [
              "Agent should modify the Python file to add LangWatch tracing",
              "Agent should use the LangWatch MCP to check LangGraph integration docs",
            ],
          }),
        ],
        script: [
          scenario.user(
            "please instrument my code with langwatch, short and sweet, no need to test the changes"
          ),
          scenario.agent(),
          (state) => {
            toolCallFix(state);
            const resultFile = fs.readFileSync(
              `${tempFolder}/main.py`,
              "utf8"
            );
            expect(resultFile).toContain("langwatch");
          },
          scenario.judge(),
        ],
      });

      expect(result.success).toBe(true);
    },
    600_000
  );

  it.skipIf(isCI)(
    "instruments a TypeScript Mastra agent with LangWatch",
    async () => {
      const tempFolder = fs.mkdtempSync(
        path.join(os.tmpdir(), "langwatch-skill-tracing-mastra-")
      );

      execSync(
        `cp -r ${path.resolve(__dirname, "fixtures/typescript-mastra")}/* ${tempFolder}/`
      );
      copySkillToWorkDir(tempFolder);

      const result = await scenario.run({
        name: "TypeScript Mastra instrumentation",
        description:
          "Implementing LangWatch instrumentation in a TypeScript Mastra agent project.",
        agents: [
          createClaudeCodeAgent({ workingDirectory: tempFolder }),
          scenario.userSimulatorAgent({ model: judgeModel }),
          scenario.judgeAgent({
            model: judgeModel,
            criteria: [
              "Agent should modify the TypeScript file to add LangWatch tracing",
              "Agent should use the LangWatch MCP to check Mastra integration docs",
            ],
          }),
        ],
        script: [
          scenario.user(
            "please instrument my code with langwatch, short and sweet, no need to test"
          ),
          scenario.agent(),
          (state) => {
            toolCallFix(state);
            const resultFile = fs.readFileSync(
              `${tempFolder}/index.ts`,
              "utf8"
            );
            expect(resultFile).toContain("langwatch");
          },
          scenario.judge(),
        ],
      });

      expect(result.success).toBe(true);
    },
    600_000
  );

  it.skipIf(isCI)(
    "instruments code without env API key — discovers from .env file",
    async () => {
      const tempFolder = fs.mkdtempSync(
        path.join(os.tmpdir(), "langwatch-skill-tracing-coldstart-")
      );

      execSync(
        `cp -r ${path.resolve(__dirname, "fixtures/python-openai")}/* ${tempFolder}/`
      );
      copySkillToWorkDir(tempFolder);

      // Write .env with API key — agent must discover this
      fs.writeFileSync(
        path.join(tempFolder, ".env"),
        `LANGWATCH_API_KEY=${process.env.LANGWATCH_API_KEY}\nOPENAI_API_KEY=${process.env.OPENAI_API_KEY}\n`
      );

      const result = await scenario.run({
        name: "Cold start tracing — no env API key",
        description:
          "Developer instruments code without LANGWATCH_API_KEY in environment. API key is in the project .env file.",
        agents: [
          createClaudeCodeAgent({
            workingDirectory: tempFolder,
            cleanEnv: true,
          }),
          scenario.userSimulatorAgent({ model: judgeModel }),
          scenario.judgeAgent({
            model: judgeModel,
            criteria: [
              "Agent should have added LangWatch tracing to the code",
              "Agent should have found or used the API key from the .env file",
            ],
          }),
        ],
        script: [
          scenario.user(
            "please instrument my code with langwatch. My API key should be in the .env file. Short and sweet, no need to test."
          ),
          scenario.agent(),
          (state) => {
            toolCallFix(state);
            const mainPy = fs.readFileSync(
              `${tempFolder}/main.py`,
              "utf8"
            );
            expect(mainPy).toContain("langwatch");
            expect(mainPy).toContain("trace");
          },
          scenario.judge(),
        ],
      });

      expect(result.success).toBe(true);
    },
    600_000
  );
});
