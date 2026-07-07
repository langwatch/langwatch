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

function copySkillToWorkDir(tempFolder: string) {
  installSkillToWorkDir({
    workingDirectory: tempFolder,
    skillSubpath: "evaluations",
  });
}

function readAllSourceFiles(dir: string): string {
  const chunks: string[] = [];
  if (!fs.existsSync(dir)) return "";

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (
      entry.isDirectory() &&
      !entry.name.startsWith(".") &&
      entry.name !== "node_modules" &&
      entry.name !== ".venv"
    ) {
      chunks.push(readAllSourceFiles(fullPath));
    } else if (entry.isFile() && /\.(py|ts|tsx|js|jsx|md)$/.test(entry.name)) {
      chunks.push(fs.readFileSync(fullPath, "utf8"));
    }
  }

  return chunks.join("\n");
}

describe("Online Evaluations Skill", () => {
  it.skipIf(isCI)(
    "adds a guardrail for a Python OpenAI bot without creating a batch experiment",
    async () => {
      const tempFolder = fs.mkdtempSync(
        path.join(os.tmpdir(), "langwatch-skill-online-evaluation-py-"),
      );

      execSync(
        `cp -r ${path.resolve(__dirname, "fixtures/python-openai")}/* ${tempFolder}/`,
      );
      copySkillToWorkDir(tempFolder);

      const result = await scenario.run({
        setId: SKILL_TESTS_SET_ID,
        name: "Python OpenAI online evaluation guardrail",
        description:
          "Adding a production guardrail to a Python OpenAI chatbot without creating a batch experiment.",
        agents: [
          createClaudeCodeAgent({ workingDirectory: tempFolder }),
          scenario.userSimulatorAgent({ model: judgeModel }),
          scenario.judgeAgent({
            model: judgeModel,
            criteria: [
              "Agent added or proposed a LangWatch online evaluation or guardrail flow for production traffic",
              "Agent did NOT create a batch experiment script or notebook",
              "Agent made the distinction between online evaluations/guardrails and experiments clear",
            ],
          }),
        ],
        script: [
          scenario.user(
            "Set up an online evaluation guardrail for my production chatbot to block jailbreak attempts. This is not a batch experiment. Read my agent code first and wire the guardrail into the request path.",
          ),
          scenario.agent(),
          (state) => {
            toolCallFix(state);
            assertSkillWasRead(state, "evaluations");

            const content = readAllSourceFiles(tempFolder).toLowerCase();
            expect(content).toContain("langwatch");
            expect(content).toMatch(/guardrail|as_guardrail|jailbreak/);
            expect(content).not.toMatch(/experiment\.init|experiments\.init/);
          },
          scenario.judge(),
        ],
      });

      expect(result.success).toBe(true);
    },
    900_000,
  );

  it.skipIf(isCI)(
    "routes batch testing requests to the experiments skill",
    async () => {
      const tempFolder = fs.mkdtempSync(
        path.join(
          os.tmpdir(),
          "langwatch-skill-evaluations-routes-experiment-",
        ),
      );

      execSync(
        `cp -r ${path.resolve(__dirname, "fixtures/python-openai")}/* ${tempFolder}/`,
      );
      copySkillToWorkDir(tempFolder);

      const result = await scenario.run({
        setId: SKILL_TESTS_SET_ID,
        name: "Online evaluations skill routes batch experiment intent",
        description:
          "User asks for batch testing while the online evaluations skill is installed. The agent should redirect to the experiments skill instead of misusing online evaluations.",
        agents: [
          createClaudeCodeAgent({ workingDirectory: tempFolder }),
          scenario.userSimulatorAgent({ model: judgeModel }),
          scenario.judgeAgent({
            model: judgeModel,
            criteria: [
              "Agent recognized that benchmarking or batch testing belongs to experiments",
              "Agent told an installed agent to load the experiments skill or told the user how to install it",
              "Agent did not claim online evaluations are the same as experiments",
            ],
          }),
        ],
        script: [
          scenario.user(
            "I want to benchmark my agent over a dataset and compare models. Use the right LangWatch workflow.",
          ),
          scenario.agent(),
          (state) => {
            toolCallFix(state);
            assertSkillWasRead(state, "evaluations");
            const allContent = state.messages
              .map((m) =>
                typeof m.content === "string"
                  ? m.content
                  : JSON.stringify(m.content),
              )
              .join("\n")
              .toLowerCase();
            expect(allContent).toContain("experiments");
            expect(allContent).toMatch(
              /npx skills add langwatch\/skills\/experiments|load.*experiments/,
            );
          },
          scenario.judge(),
        ],
      });

      expect(result.success).toBe(true);
    },
    900_000,
  );
});
