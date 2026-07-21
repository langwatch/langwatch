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
  installSkillToWorkDir,
  SKILL_TESTS_SET_ID,
} from "./helpers/claude-code-adapter";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, "../.env") });

const isCI = !!process.env.CI;
const judgeModel = openai("gpt-5-mini");

describe("Agent Improvement Skill", () => {
  it.skipIf(isCI)(
    "proposes evidence-backed hypotheses and explains them before building anything",
    async () => {
      const tempFolder = fs.mkdtempSync(
        path.join(os.tmpdir(), "langwatch-skill-agent-improve-")
      );

      // A sample agent codebase gives the proposals something concrete to
      // change: system prompt, tool definitions, and an obvious improvement
      // surface. Production evidence comes from the LangWatch project the
      // API key points at.
      fs.cpSync(path.resolve(__dirname, "fixtures/python-openai"), tempFolder, {
        recursive: true,
      });

      installSkillToWorkDir({
        workingDirectory: tempFolder,
        skillSubpath: "agent-improve",
      });

      const result = await scenario.run({
        setId: SKILL_TESTS_SET_ID,
        name: "Agent improvement hypotheses",
        description:
          "User has an agent in production with traces in LangWatch and wants to know what to do next to improve it. The user expects to understand the reasoning behind every proposal, and will pick one hypothesis to execute.",
        agents: [
          createClaudeCodeAgent({ workingDirectory: tempFolder }),
          scenario.userSimulatorAgent({ model: judgeModel }),
          scenario.judgeAgent({
            model: judgeModel,
            criteria: [
              "Agent gathered evidence through the `langwatch` CLI (analytics query, trace export, or trace search) BEFORE proposing improvements",
              "Agent presented hypotheses where each one states an observation from the data, the suspected cause, and the expected effect of fixing it",
              "Agent explained WHY each hypothesis is worth testing, in plain language a user can follow",
              "Proposals are actionable artifacts: scenario tests reproducing issues, prompt or code changes, evaluators or monitors capturing production signals, or experiments",
              "Agent waited for the user to choose before executing a hypothesis, and executed the chosen one (for example writing a scenario test or drafting the change)",
              "After the user asked for minimal execution, the agent kept to creating and showing the artifact without booting the app or installing heavy dependencies",
            ],
          }),
        ],
        script: [
          scenario.user("what should I do next to improve my agent?"),
          scenario.agent(),
          (state) => {
            toolCallFix(state);
            assertSkillWasRead(state, "agent-improve");
          },
          scenario.user(
            "the first hypothesis makes sense to me, go ahead and set it up as you proposed. Keep it minimal: create the artifact and show it to me, no need to run the app or install anything heavy"
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
    // Two full agent turns: evidence sweep + hypothesis execution. Each turn
    // is a long autonomous run, so this needs more than the single-turn 15m.
    1_800_000
  );
});
