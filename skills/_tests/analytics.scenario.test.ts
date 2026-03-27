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
  assertSkillWasRead,
} from "./helpers/claude-code-adapter";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, "../.env") });

const isCI = !!process.env.CI;
const judgeModel = openai("gpt-5-mini");

describe("Analytics Skill", () => {
  it.skipIf(isCI)(
    "queries agent performance from an empty directory",
    async () => {
      const tempFolder = fs.mkdtempSync(
        path.join(os.tmpdir(), "langwatch-skill-analytics-")
      );

      const skillDir = path.join(tempFolder, ".skills", "analytics");
      fs.mkdirSync(skillDir, { recursive: true });
      fs.copyFileSync(
        path.resolve(__dirname, "../analytics/SKILL.md"),
        path.join(skillDir, "SKILL.md")
      );
      const sharedDir = path.join(skillDir, "_shared");
      fs.mkdirSync(sharedDir, { recursive: true });
      const sharedSrc = path.resolve(__dirname, "../_shared");
      fs.cpSync(sharedSrc, sharedDir, { recursive: true });

      const result = await scenario.run({
        name: "Agent performance analytics",
        description:
          "User wants to understand how their agent has been performing.",
        agents: [
          createClaudeCodeAgent({ workingDirectory: tempFolder }),
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
            assertSkillWasRead(state, "analytics");
          },
          scenario.judge(),
        ],
      });

      expect(result.success).toBe(true);
    },
    600_000
  );
});
