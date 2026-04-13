import scenario from "@langwatch/scenario";
import fs from "fs";
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

describe("LangWatch CLI CRUD — Agent Usability", () => {
  it.skipIf(isCI)(
    "agent uses CLI to list, create, and manage scenarios",
    async () => {
      const tempFolder = fs.mkdtempSync(
        path.join(os.tmpdir(), "langwatch-cli-scenarios-"),
      );

      fs.writeFileSync(
        path.join(tempFolder, ".env"),
        `LANGWATCH_API_KEY=${process.env.LANGWATCH_API_KEY}\n`,
      );

      const result = await scenario.run({
        name: "CLI scenario CRUD",
        description:
          "Developer wants to manage agent test scenarios using the LangWatch CLI.",
        agents: [
          createClaudeCodeAgent({ workingDirectory: tempFolder }),
          scenario.userSimulatorAgent({ model: judgeModel }),
          scenario.judgeAgent({
            model: judgeModel,
            criteria: [
              "Agent used langwatch scenario list to view existing scenarios",
              "Agent used langwatch scenario create to create a new scenario with a situation and criteria",
              "Agent successfully created at least one scenario (received confirmation with an ID)",
            ],
          }),
        ],
        script: [
          scenario.user(
            "Use the langwatch CLI to manage scenarios. First list any existing scenarios, then create a new scenario called 'Customer Support Flow' with the situation 'Customer asks for a refund on a damaged product' and criteria 'Agent shows empathy,Agent offers refund or replacement,Agent confirms resolution'. The langwatch CLI is already installed globally. You have LANGWATCH_API_KEY in the .env file.",
          ),
          scenario.agent(),
          (state) => {
            toolCallFix(state);

            // Verify the agent used CLI commands (not MCP or API directly)
            const allText = state.messages
              .map((m) =>
                typeof m.content === "string"
                  ? m.content
                  : JSON.stringify(m.content),
              )
              .join("\n");

            expect(allText).toMatch(/langwatch\s+scenario/);
          },
          scenario.judge(),
        ],
      });

      expect(result.success).toBe(true);
    },
    600_000,
  );

  it.skipIf(isCI)(
    "agent uses CLI to manage datasets end-to-end",
    async () => {
      const tempFolder = fs.mkdtempSync(
        path.join(os.tmpdir(), "langwatch-cli-datasets-"),
      );

      fs.writeFileSync(
        path.join(tempFolder, ".env"),
        `LANGWATCH_API_KEY=${process.env.LANGWATCH_API_KEY}\n`,
      );

      // Create a sample CSV file for upload
      fs.writeFileSync(
        path.join(tempFolder, "test-data.csv"),
        "input,expected_output\nWhat is 2+2?,4\nWhat is the capital of France?,Paris\nTranslate hello to Spanish,Hola\n",
      );

      const result = await scenario.run({
        name: "CLI dataset management",
        description:
          "Developer wants to create a dataset, upload test data, and verify the records using the LangWatch CLI.",
        agents: [
          createClaudeCodeAgent({ workingDirectory: tempFolder }),
          scenario.userSimulatorAgent({ model: judgeModel }),
          scenario.judgeAgent({
            model: judgeModel,
            criteria: [
              "Agent used langwatch dataset commands to manage datasets",
              "Agent created or uploaded a dataset with the test CSV data",
              "Agent listed or verified the dataset records were uploaded correctly",
            ],
          }),
        ],
        script: [
          scenario.user(
            "Use the langwatch CLI to work with datasets. Create a dataset called 'qa-test-set', upload the test-data.csv file I've placed in the current directory, then list the records to verify they were uploaded. The langwatch CLI is already installed globally. You have LANGWATCH_API_KEY in the .env file.",
          ),
          scenario.agent(),
          (state) => {
            toolCallFix(state);

            const allText = state.messages
              .map((m) =>
                typeof m.content === "string"
                  ? m.content
                  : JSON.stringify(m.content),
              )
              .join("\n");

            expect(allText).toMatch(/langwatch\s+dataset/);
          },
          scenario.judge(),
        ],
      });

      expect(result.success).toBe(true);
    },
    600_000,
  );

  it.skipIf(isCI)(
    "agent uses CLI to query analytics and search traces",
    async () => {
      const tempFolder = fs.mkdtempSync(
        path.join(os.tmpdir(), "langwatch-cli-analytics-"),
      );

      fs.writeFileSync(
        path.join(tempFolder, ".env"),
        `LANGWATCH_API_KEY=${process.env.LANGWATCH_API_KEY}\n`,
      );

      const result = await scenario.run({
        name: "CLI analytics and traces",
        description:
          "Developer wants to check their LLM application performance using the CLI.",
        agents: [
          createClaudeCodeAgent({ workingDirectory: tempFolder }),
          scenario.userSimulatorAgent({ model: judgeModel }),
          scenario.judgeAgent({
            model: judgeModel,
            criteria: [
              "Agent used langwatch analytics or trace commands to query data",
              "Agent provided useful information about the project's traces or analytics",
              "Agent used the CLI (not MCP tools) to get the information",
            ],
          }),
        ],
        script: [
          scenario.user(
            "Use the langwatch CLI to check how my LLM application is doing. Query the analytics for trace count and search for any recent traces. Tell me what you find. The langwatch CLI is already installed globally. You have LANGWATCH_API_KEY in the .env file.",
          ),
          scenario.agent(),
          (state) => {
            toolCallFix(state);

            const allText = state.messages
              .map((m) =>
                typeof m.content === "string"
                  ? m.content
                  : JSON.stringify(m.content),
              )
              .join("\n");

            // Verify agent used CLI commands
            const usedAnalytics = allText.match(/langwatch\s+analytics/);
            const usedTrace = allText.match(/langwatch\s+trace/);
            expect(
              usedAnalytics || usedTrace,
              "Expected agent to use langwatch analytics or trace CLI commands",
            ).toBeTruthy();
          },
          scenario.judge(),
        ],
      });

      expect(result.success).toBe(true);
    },
    600_000,
  );
});
