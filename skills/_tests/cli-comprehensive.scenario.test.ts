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
dotenv.config({ path: path.resolve(__dirname, "../../typescript-sdk/.env") });

const isCI = !!process.env.CI;
const judgeModel = openai("gpt-5-mini");

describe("LangWatch CLI Comprehensive — Agent Usability", () => {
  it.skipIf(isCI)(
    "agent uses status command to get project overview then drills into details",
    async () => {
      const tempFolder = fs.mkdtempSync(
        path.join(os.tmpdir(), "langwatch-cli-status-"),
      );

      fs.writeFileSync(
        path.join(tempFolder, ".env"),
        `LANGWATCH_API_KEY=${process.env.LANGWATCH_API_KEY}\n${process.env.LANGWATCH_ENDPOINT ? `LANGWATCH_ENDPOINT=${process.env.LANGWATCH_ENDPOINT}\n` : ""}`,
      );
      setupLocalCli(tempFolder);

      fs.writeFileSync(
        path.join(tempFolder, "CLAUDE.md"),
        `# IMPORTANT: Use the langwatch CLI via Bash, NOT MCP tools
DO NOT use any MCP tools (mcp__claude_ai_LangWatch__*). Use ONLY the Bash tool to run the \`langwatch\` CLI.

First, load the API key: \`export $(grep LANGWATCH_API_KEY .env)\`

Then run CLI commands:
- \`langwatch status\` for project overview
- \`langwatch evaluator list --format json\` for structured evaluator data
- \`langwatch prompt list --format json\` for structured prompt data
- \`langwatch dataset list --format json\` for structured dataset data
`,
      );

      const result = await scenario.run({
        name: "CLI status + structured output",
        description:
          "Developer wants to understand their LangWatch project using the CLI, getting structured JSON data from multiple commands.",
        agents: [
          createClaudeCodeAgent({
            workingDirectory: tempFolder,
            skipMcp: true,
          }),
          scenario.userSimulatorAgent({ model: judgeModel }),
          scenario.judgeAgent({
            model: judgeModel,
            criteria: [
              "Agent ran `langwatch status` to get a project overview",
              "Agent ran at least one list command with `--format json` to get structured data",
              "Agent summarized the project state including resource counts",
            ],
          }),
        ],
        script: [
          scenario.user(
            "Read the CLAUDE.md file first, then use the Bash tool to:\n1. `export $(grep LANGWATCH_API_KEY .env)`\n2. `langwatch status` to see the project overview\n3. `langwatch evaluator list --format json` to get evaluator details\n4. Summarize what you found about this project\n\nDo NOT use MCP tools. Use ONLY the Bash tool.",
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

            expect(allText).toMatch(/langwatch\s+status/);
          },
          scenario.judge(),
        ],
      });

      expect(result.success).toBe(true);
    },
    600_000,
  );

  it.skipIf(isCI)(
    "agent uses CLI to manage prompts with version tracking",
    async () => {
      const tempFolder = fs.mkdtempSync(
        path.join(os.tmpdir(), "langwatch-cli-prompts-"),
      );

      fs.writeFileSync(
        path.join(tempFolder, ".env"),
        `LANGWATCH_API_KEY=${process.env.LANGWATCH_API_KEY}\n${process.env.LANGWATCH_ENDPOINT ? `LANGWATCH_ENDPOINT=${process.env.LANGWATCH_ENDPOINT}\n` : ""}`,
      );
      setupLocalCli(tempFolder);

      fs.writeFileSync(
        path.join(tempFolder, "CLAUDE.md"),
        `# IMPORTANT: Use the langwatch CLI via Bash, NOT MCP tools
DO NOT use any MCP tools. Use ONLY the Bash tool to run the \`langwatch\` CLI.

First: \`export $(grep LANGWATCH_API_KEY .env)\`

Prompt management commands:
- \`langwatch prompt list --format json\` — list all prompts
- \`langwatch prompt versions <handle>\` — list version history
- \`langwatch prompt tag list\` — list available tags
`,
      );

      const result = await scenario.run({
        name: "CLI prompt version management",
        description:
          "Developer wants to inspect prompt versions and tags using the LangWatch CLI.",
        agents: [
          createClaudeCodeAgent({
            workingDirectory: tempFolder,
            skipMcp: true,
          }),
          scenario.userSimulatorAgent({ model: judgeModel }),
          scenario.judgeAgent({
            model: judgeModel,
            criteria: [
              "Agent ran `langwatch prompt list` to find available prompts",
              "Agent ran `langwatch prompt versions` for a specific prompt to see version history",
              "Agent reported findings about the prompt's version history",
            ],
          }),
        ],
        script: [
          scenario.user(
            "Read the CLAUDE.md file first, then use the Bash tool to:\n1. `export $(grep LANGWATCH_API_KEY .env)`\n2. `langwatch prompt list --format json` to find prompts\n3. If any prompts exist, run `langwatch prompt versions <handle>` to see the version history\n4. Tell me what you found\n\nDo NOT use MCP tools. Use ONLY the Bash tool.",
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

            expect(allText).toMatch(/langwatch\s+prompt/);
          },
          scenario.judge(),
        ],
      });

      expect(result.success).toBe(true);
    },
    600_000,
  );
});
