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
  setupLocalCli,
  toolCallFix,
} from "./helpers/claude-code-adapter";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, ".env") });

const isCI = !!process.env.CI;
const judgeModel = openai("gpt-5-mini");

describe("LangWatch CLI Suites — Agent Usability", () => {
  it.skipIf(isCI)(
    "agent uses CLI to list suites and create a suite",
    async () => {
      const tempFolder = fs.mkdtempSync(
        path.join(os.tmpdir(), "langwatch-cli-suites-"),
      );

      fs.writeFileSync(
        path.join(tempFolder, ".env"),
        `LANGWATCH_API_KEY=${process.env.LANGWATCH_API_KEY}\n`,
      );
      setupLocalCli(tempFolder);

      fs.writeFileSync(
        path.join(tempFolder, "CLAUDE.md"),
        `# IMPORTANT: Use the langwatch CLI via Bash, NOT MCP tools
DO NOT use any MCP tools (mcp__claude_ai_LangWatch__*). Use ONLY the Bash tool to run the \`langwatch\` CLI.

First, load the API key: \`export $(grep LANGWATCH_API_KEY .env)\`

Then run these commands:
1. \`langwatch suite list\` — list existing suites (run plans)
2. \`langwatch scenario list --format json\` — get scenario IDs
3. \`langwatch agent list --format json\` — get agent IDs
4. If scenarios and agents exist, create a suite:
   \`langwatch suite create "Regression Test" --scenarios <id1>,<id2> --targets http:<agentId>\`
5. \`langwatch suite list\` — verify the suite was created
`,
      );

      const result = await scenario.run({
        name: "CLI suite management",
        description:
          "Developer wants to manage suites (run plans) using the LangWatch CLI.",
        agents: [
          createClaudeCodeAgent({ workingDirectory: tempFolder, skipMcp: true }),
          scenario.userSimulatorAgent({ model: judgeModel }),
          scenario.judgeAgent({
            model: judgeModel,
            criteria: [
              "Agent ran `langwatch suite list` via the Bash tool",
              "Agent ran `langwatch scenario list` to discover scenario IDs",
              "Agent attempted to create a suite using `langwatch suite create` or reported that scenarios/agents are needed first",
            ],
          }),
        ],
        script: [
          scenario.user(
            "Read the CLAUDE.md file first, then use the Bash tool to follow the steps described. List suites, find scenarios and agents, and try to create a suite if possible. Do NOT use MCP tools.",
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

            expect(allText).toMatch(/langwatch\s+suite/);
          },
          scenario.judge(),
        ],
      });

      expect(result.success).toBe(true);
    },
    600_000,
  );

  it.skipIf(isCI)(
    "agent uses CLI to view simulation run results",
    async () => {
      const tempFolder = fs.mkdtempSync(
        path.join(os.tmpdir(), "langwatch-cli-sim-runs-"),
      );

      fs.writeFileSync(
        path.join(tempFolder, ".env"),
        `LANGWATCH_API_KEY=${process.env.LANGWATCH_API_KEY}\n`,
      );
      setupLocalCli(tempFolder);

      fs.writeFileSync(
        path.join(tempFolder, "CLAUDE.md"),
        `# IMPORTANT: Use the langwatch CLI via Bash, NOT MCP tools
DO NOT use any MCP tools. Use ONLY the Bash tool.

First: \`export $(grep LANGWATCH_API_KEY .env)\`
Then: \`langwatch simulation-run list\`
If runs exist, get details: \`langwatch simulation-run get <runId>\`
`,
      );

      const result = await scenario.run({
        name: "CLI simulation run inspection",
        description:
          "Developer wants to inspect simulation run results using the CLI.",
        agents: [
          createClaudeCodeAgent({ workingDirectory: tempFolder, skipMcp: true }),
          scenario.userSimulatorAgent({ model: judgeModel }),
          scenario.judgeAgent({
            model: judgeModel,
            criteria: [
              "Agent ran `langwatch simulation-run list` via the Bash tool",
              "Agent reported whether any simulation runs exist or not",
            ],
          }),
        ],
        script: [
          scenario.user(
            "Read the CLAUDE.md file first, then use the Bash tool to list simulation runs and inspect any available results. Do NOT use MCP tools.",
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

            expect(allText).toMatch(/langwatch\s+simulation-run/);
          },
          scenario.judge(),
        ],
      });

      expect(result.success).toBe(true);
    },
    600_000,
  );

  it.skipIf(isCI)(
    "agent uses CLI to manage triggers",
    async () => {
      const tempFolder = fs.mkdtempSync(
        path.join(os.tmpdir(), "langwatch-cli-triggers-"),
      );

      fs.writeFileSync(
        path.join(tempFolder, ".env"),
        `LANGWATCH_API_KEY=${process.env.LANGWATCH_API_KEY}\n`,
      );
      setupLocalCli(tempFolder);

      fs.writeFileSync(
        path.join(tempFolder, "CLAUDE.md"),
        `# IMPORTANT: Use the langwatch CLI via Bash, NOT MCP tools
DO NOT use any MCP tools. Use ONLY the Bash tool.

First: \`export $(grep LANGWATCH_API_KEY .env)\`
Then: \`langwatch trigger list\`
Then: \`langwatch trigger create "Error Alert" --action SEND_EMAIL --alert-type CRITICAL\`
Then: \`langwatch trigger list --format json\`
`,
      );

      const result = await scenario.run({
        name: "CLI trigger management",
        description:
          "Developer wants to manage triggers (automations) using the CLI.",
        agents: [
          createClaudeCodeAgent({ workingDirectory: tempFolder, skipMcp: true }),
          scenario.userSimulatorAgent({ model: judgeModel }),
          scenario.judgeAgent({
            model: judgeModel,
            criteria: [
              "Agent ran `langwatch trigger list` via the Bash tool",
              "Agent ran `langwatch trigger create` to create a new trigger",
              "Agent received confirmation with a trigger ID after creation",
            ],
          }),
        ],
        script: [
          scenario.user(
            "Read the CLAUDE.md file first, then use the Bash tool to list triggers, create a new email alert trigger, and verify it was created. Do NOT use MCP tools.",
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

            expect(allText).toMatch(/langwatch\s+trigger/);
          },
          scenario.judge(),
        ],
      });

      expect(result.success).toBe(true);
    },
    600_000,
  );
});
