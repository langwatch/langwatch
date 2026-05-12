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
