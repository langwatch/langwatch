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
  const skillDir = path.join(tempFolder, ".skills", "level-up");
  fs.mkdirSync(skillDir, { recursive: true });
  fs.copyFileSync(
    path.resolve(__dirname, "../level-up/SKILL.md"),
    path.join(skillDir, "SKILL.md")
  );
  const sharedDir = path.join(skillDir, "_shared");
  fs.mkdirSync(sharedDir, { recursive: true });
  execSync(
    `cp -r ${path.resolve(__dirname, "../_shared")}/* ${sharedDir}/`
  );
}

describe("Level-up Skill", () => {
  it.skipIf(isCI)(
    "orchestrates all sub-skills for a Python OpenAI bot",
    async () => {
      const tempFolder = fs.mkdtempSync(
        path.join(os.tmpdir(), "langwatch-skill-level-up-py-")
      );

      execSync(
        `cp -r ${path.resolve(__dirname, "fixtures/python-openai")}/* ${tempFolder}/`
      );
      copySkillToWorkDir(tempFolder);

      const result = await scenario.run({
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

  it.skipIf(isCI)(
    "orchestrates all sub-skills for a TypeScript Vercel AI bot",
    async () => {
      const tempFolder = fs.mkdtempSync(
        path.join(os.tmpdir(), "langwatch-skill-level-up-ts-")
      );
      execSync(
        `cp -r ${path.resolve(__dirname, "fixtures/typescript-vercel")}/* ${tempFolder}/`
      );
      copySkillToWorkDir(tempFolder);

      const result = await scenario.run({
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
});
