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

/**
 * Bare-CLI auth-discovery test.
 *
 * No skill files, no .env, no CLAUDE.md. Agent is dropped in an empty dir and
 * asked to do something that requires the LangWatch CLI. The CLI itself must
 * surface enough information (in its --help text and missing-key error) for the
 * agent to point the user at `${endpoint}/authorize` to obtain a key.
 */
describe("LangWatch CLI Auth Discovery — bare CLI, no skill", () => {
  it.skipIf(isCI)(
    "agent guides user to /authorize when no API key is configured",
    async () => {
      const tempFolder = fs.mkdtempSync(
        path.join(os.tmpdir(), "langwatch-cli-auth-"),
      );

      // No .env, no CLAUDE.md, no .skills/ — bare directory with only the CLI.
      const result = await scenario.run({
        setId: SKILL_TESTS_SET_ID,
        name: "CLI auth discovery from scratch",
        description:
          "User has the langwatch CLI installed but no API key. They ask the agent to use LangWatch. The agent must figure out auth from the CLI's own help/error text without any skill instructions.",
        agents: [
          createClaudeCodeAgent({
            workingDirectory: tempFolder,
            cleanEnv: true,
          }),
          scenario.userSimulatorAgent({ model: judgeModel }),
          scenario.judgeAgent({
            model: judgeModel,
            criteria: [
              "Agent invoked the langwatch CLI (e.g. `langwatch login --help`, `langwatch status`, `langwatch prompt list`, or similar)",
              "Agent told the user about the /authorize URL on app.langwatch.ai (or the equivalent self-hosted ${endpoint}/authorize URL) for getting an API key",
              "Agent did NOT hallucinate a fake API key, and did NOT recommend manually editing source files for auth",
            ],
          }),
        ],
        script: [
          scenario.user("use langwatch to list my prompts"),
          scenario.agent(),
          (state) => {
            toolCallFix(state);
          },
          scenario.judge(),
        ],
      });

      expect(result.success).toBe(true);
    },
    900_000,
  );
});

/**
 * Regression for the customer report: a coding agent setting up experiments
 * ran `langwatch login`, signed in to a personal project, and the evaluations
 * went there. With the evaluations skill (and the projects-and-api-keys shared
 * snippet), the agent must use the project API key already in `.env` and must
 * never run the AI-tools / device login or target a personal project.
 */
describe("LangWatch CLI Auth: skill setup stays on a real project", () => {
  it.skipIf(isCI)(
    "uses the .env project key and never device / personal login",
    async () => {
      const tempFolder = fs.mkdtempSync(
        path.join(os.tmpdir(), "langwatch-cli-auth-project-"),
      );
      // A real minimal agent with a project API key already present in .env.
      fs.cpSync(
        path.resolve(__dirname, "fixtures/python-openai"),
        tempFolder,
        { recursive: true },
      );
      const apiKey = process.env.LANGWATCH_API_KEY;
      if (!apiKey) {
        throw new Error(
          "LANGWATCH_API_KEY is required for this scenario test",
        );
      }
      fs.writeFileSync(
        path.join(tempFolder, ".env"),
        `LANGWATCH_API_KEY=${apiKey}\n`,
      );
      installSkillToWorkDir({
        workingDirectory: tempFolder,
        skillSubpath: "evaluations",
      });

      const result = await scenario.run({
        setId: SKILL_TESTS_SET_ID,
        name: "Evaluation setup stays on a real project",
        description:
          "User asks the agent (with the evaluations skill installed) to set up a batch evaluation. A project API key is already in .env. The agent must use that real project key and must NOT run an AI-tools/device login or create/target a personal project.",
        agents: [
          createClaudeCodeAgent({ workingDirectory: tempFolder }),
          scenario.userSimulatorAgent({ model: judgeModel }),
          scenario.judgeAgent({
            model: judgeModel,
            criteria: [
              "Agent used the LANGWATCH_API_KEY already present in .env (a real project key) for the setup",
              "Agent did NOT run `langwatch login --device` or any device / SSO / AI-tools login",
              "Agent did NOT create, select, or target a personal project / 'My Workspace' / personal workspace",
            ],
          }),
        ],
        script: [
          scenario.user(
            "set up a batch evaluation experiment for my agent using langwatch",
          ),
          scenario.agent(),
          (state) => {
            toolCallFix(state);
            assertSkillWasRead(state, "evaluations");
            const transcript = state.messages
              .map((m) =>
                typeof m.content === "string"
                  ? m.content
                  : JSON.stringify(m.content),
              )
              .join("\n")
              .toLowerCase();
            // Hard guardrail: the AI-tools / device login must never be invoked
            // for evaluation setup, that is what routes to a personal project.
            expect(
              transcript.includes("login --device"),
              "agent must not run `langwatch login --device` for evaluation setup",
            ).toBe(false);
          },
          scenario.judge(),
        ],
      });

      expect(result.success).toBe(true);
    },
    900_000,
  );
});
