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

const skillPath = path.resolve(__dirname, "../tracing/SKILL.md");

describe("Tracing Skill", () => {
  it.skipIf(isCI || runnerUnavailable)(
    "instruments a Python OpenAI bot with LangWatch",
    async () => {
      const tempFolder = fs.mkdtempSync(
        path.join(os.tmpdir(), "langwatch-skill-instrument-py-")
      );

      execSync(
        `cp -r ${path.resolve(__dirname, "fixtures/python-openai")}/* ${tempFolder}/`
      );

      const result = await scenario.run({
        name: "Python OpenAI instrumentation",
        description:
          "Implementing LangWatch instrumentation in a Python OpenAI bot project.",
        agents: [
          createAgent({ workingDirectory: tempFolder, skillPath }),
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

  it.skipIf(isCI || runnerUnavailable)(
    "instruments a TypeScript Vercel AI bot with LangWatch",
    async () => {
      const tempFolder = fs.mkdtempSync(
        path.join(os.tmpdir(), "langwatch-skill-instrument-ts-")
      );

      execSync(
        `cp -r ${path.resolve(__dirname, "fixtures/typescript-vercel")}/* ${tempFolder}/`
      );

      const result = await scenario.run({
        name: "TypeScript Vercel AI instrumentation",
        description:
          "Implementing LangWatch instrumentation in a TypeScript Vercel AI bot project.",
        agents: [
          createAgent({ workingDirectory: tempFolder, skillPath }),
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

  it.skipIf(isCI || runnerUnavailable)(
    "instruments a Python LangGraph agent with LangWatch",
    async () => {
      const tempFolder = fs.mkdtempSync(
        path.join(os.tmpdir(), "langwatch-skill-tracing-langgraph-")
      );

      execSync(
        `cp -r ${path.resolve(__dirname, "fixtures/python-langgraph")}/* ${tempFolder}/`
      );

      const result = await scenario.run({
        name: "Python LangGraph instrumentation",
        description:
          "Implementing LangWatch instrumentation in a Python LangGraph agent project.",
        agents: [
          createAgent({ workingDirectory: tempFolder, skillPath }),
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

  it.skipIf(isCI || runnerUnavailable)(
    "instruments a TypeScript Mastra agent with LangWatch",
    async () => {
      const tempFolder = fs.mkdtempSync(
        path.join(os.tmpdir(), "langwatch-skill-tracing-mastra-")
      );

      execSync(
        `cp -r ${path.resolve(__dirname, "fixtures/typescript-mastra")}/* ${tempFolder}/`
      );

      const result = await scenario.run({
        name: "TypeScript Mastra instrumentation",
        description:
          "Implementing LangWatch instrumentation in a TypeScript Mastra agent project.",
        agents: [
          createAgent({ workingDirectory: tempFolder, skillPath }),
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

  it.skipIf(isCI || runnerUnavailable)(
    "instruments code without env API key — discovers from .env file",
    async () => {
      const tempFolder = fs.mkdtempSync(
        path.join(os.tmpdir(), "langwatch-skill-tracing-coldstart-")
      );

      execSync(
        `cp -r ${path.resolve(__dirname, "fixtures/python-openai")}/* ${tempFolder}/`
      );

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
          createAgent({
            workingDirectory: tempFolder,
            skillPath,
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

  it.skipIf(isCI || runnerUnavailable || !runner.capabilities.supportsMcp)(
    "instruments code without MCP — uses llms.txt fallback for docs",
    async () => {
      const tempFolder = fs.mkdtempSync(
        path.join(os.tmpdir(), "langwatch-skill-tracing-nomcp-")
      );
      execSync(
        `cp -r ${path.resolve(__dirname, "fixtures/python-openai")}/* ${tempFolder}/`
      );

      // Write .env with API key
      fs.writeFileSync(
        path.join(tempFolder, ".env"),
        `LANGWATCH_API_KEY=${process.env.LANGWATCH_API_KEY}\n`
      );

      const result = await scenario.run({
        name: "Tracing without MCP — llms.txt fallback",
        description:
          "Agent instruments code without MCP access, using direct URL fetching for docs.",
        agents: [
          createAgent({
            workingDirectory: tempFolder,
            skillPath,
            skipMcp: true,
          }),
          scenario.userSimulatorAgent({ model: judgeModel }),
          scenario.judgeAgent({
            model: judgeModel,
            criteria: [
              "Agent should have added LangWatch tracing to the code",
              "Agent should have fetched documentation via URLs since MCP is not available",
            ],
          }),
        ],
        script: [
          scenario.user(
            "please instrument my code with langwatch. The LangWatch MCP is not installed, but you can fetch docs directly from https://langwatch.ai/docs/llms.txt. My API key is in the .env file. Short and sweet, no need to test."
          ),
          scenario.agent(),
          (state) => {
            toolCallFix(state);
            const mainPy = fs.readFileSync(`${tempFolder}/main.py`, "utf8");
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

  it.skipIf(isCI || runnerUnavailable)(
    "asks user for API key when not found in environment or .env",
    async () => {
      const tempFolder = fs.mkdtempSync(
        path.join(os.tmpdir(), "langwatch-skill-tracing-nokey-")
      );
      execSync(
        `cp -r ${path.resolve(__dirname, "fixtures/python-openai")}/* ${tempFolder}/`
      );

      // NO .env file — agent must ask user for the key

      const result = await scenario.run({
        name: "Tracing — agent asks for API key",
        description:
          "Agent instruments code but has no API key available. Must ask the user.",
        agents: [
          createAgent({
            workingDirectory: tempFolder,
            skillPath,
            cleanEnv: true,
          }),
          scenario.userSimulatorAgent({ model: judgeModel }),
          scenario.judgeAgent({
            model: judgeModel,
            criteria: [
              "Agent should have asked the user for a LangWatch API key or directed them to get one",
              "Agent should have added LangWatch tracing to the code after receiving the key",
            ],
          }),
        ],
        script: [
          scenario.user(
            "please instrument my code with langwatch, short and sweet, no need to test"
          ),
          scenario.agent(),
          // Agent should ask for API key — we provide it
          scenario.user(
            `Here is my LangWatch API key: ${process.env.LANGWATCH_API_KEY}. Please save it to .env and continue with the instrumentation.`
          ),
          scenario.agent(),
          (state) => {
            toolCallFix(state);
            const mainPy = fs.readFileSync(`${tempFolder}/main.py`, "utf8");
            expect(mainPy).toContain("langwatch");

            // Verify .env was created with the key
            const envFile = path.join(tempFolder, ".env");
            if (fs.existsSync(envFile)) {
              const envContent = fs.readFileSync(envFile, "utf8");
              expect(envContent).toContain("LANGWATCH_API_KEY");
            }
          },
          scenario.judge(),
        ],
      });
      expect(result.success).toBe(true);
    },
    900_000 // longer timeout for multi-turn
  );
});
