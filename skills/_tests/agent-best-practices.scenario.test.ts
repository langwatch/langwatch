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
  assertSkillWasRead,
  installSkillToWorkDir,
  SKILL_TESTS_SET_ID,
} from "./helpers/claude-code-adapter";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, "../.env") });

const isCI = !!process.env.CI;
const judgeModel = openai("gpt-5-mini");

describe("Agent Best Practices Skill", () => {
  it.skipIf(isCI)(
    "audits the project against best practices and closes the highest-impact gaps first",
    async () => {
      const tempFolder = fs.mkdtempSync(
        path.join(os.tmpdir(), "langwatch-skill-agent-best-practices-")
      );

      // A minimal agent codebase with no scenarios, no versioned prompts, and
      // no evaluation setup: plenty of best-practice gaps for the audit to find.
      execSync(
        `cp -r ${path.resolve(__dirname, "fixtures/python-openai")}/* ${tempFolder}/`
      );

      installSkillToWorkDir({
        workingDirectory: tempFolder,
        skillSubpath: "recipes/agent-best-practices",
        installAs: "agent-best-practices",
      });

      const result = await scenario.run({
        setId: SKILL_TESTS_SET_ID,
        name: "Agent development best practices audit",
        description:
          "User wants to know where their agent development practices can improve. Their project is a small chatbot with hardcoded prompts and no tests.",
        agents: [
          createClaudeCodeAgent({ workingDirectory: tempFolder }),
          scenario.userSimulatorAgent({ model: judgeModel }),
          scenario.judgeAgent({
            model: judgeModel,
            criteria: [
              "Agent read the project codebase AND audited the LangWatch side through CLI list commands (scenarios, evaluators, monitors, prompts, or traces)",
              "Agent identified concrete best-practice gaps specific to THIS project (such as hardcoded prompts or missing scenario tests), not generic advice",
              "Agent prioritized: it named the highest-impact gaps first and either fixed one or proposed to fix it, rather than dumping a long unranked list",
            ],
          }),
        ],
        script: [
          scenario.user(
            "where can I improve our agent development best practices?"
          ),
          scenario.agent(),
          (state) => {
            toolCallFix(state);
            assertSkillWasRead(state, "agent-best-practices");
          },
          scenario.judge(),
        ],
      });

      expect(result.success).toBe(true);
    },
    900_000
  );
});
