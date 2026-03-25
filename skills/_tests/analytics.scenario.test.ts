import scenario from "@langwatch/scenario";
import fs from "fs";
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

const skillPath = path.resolve(__dirname, "../analytics/SKILL.md");

describe("Analytics Skill", () => {
  it.skipIf(isCI || runnerUnavailable || !runner.capabilities.supportsMcp)(
    "queries agent performance from an empty directory",
    async () => {
      const tempFolder = fs.mkdtempSync(
        path.join(os.tmpdir(), "langwatch-skill-analytics-")
      );

      const result = await scenario.run({
        name: "Agent performance analytics",
        description:
          "User wants to understand how their agent has been performing.",
        agents: [
          createAgent({ workingDirectory: tempFolder, skillPath }),
          scenario.userSimulatorAgent({ model: judgeModel }),
          scenario.judgeAgent({
            model: judgeModel,
            criteria: [
              "Agent used LangWatch MCP tools to query analytics or search traces",
              "Agent provided a summary of performance data",
            ],
          }),
        ],
        script: [
          scenario.user(
            "tell me how my agent has been performing, give me a summary of the last 7 days"
          ),
          scenario.agent(),
          (state) => {
            toolCallFix(state);
          },
          scenario.judge(),
        ],
      });

      expect(result.success).toBe(true);
    },
    600_000
  );
});
