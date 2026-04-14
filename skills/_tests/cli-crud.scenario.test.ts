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

describe("LangWatch CLI CRUD — Agent Usability", () => {
  it.skipIf(isCI)(
    "agent uses CLI to list and create scenarios",
    async () => {
      const tempFolder = fs.mkdtempSync(
        path.join(os.tmpdir(), "langwatch-cli-scenarios-"),
      );

      fs.writeFileSync(
        path.join(tempFolder, ".env"),
        `LANGWATCH_API_KEY=${process.env.LANGWATCH_API_KEY}\n`,
      );
      setupLocalCli(tempFolder);

      // Guide Claude Code to use the CLI directly - NOT MCP
      fs.writeFileSync(
        path.join(tempFolder, "CLAUDE.md"),
        `# IMPORTANT: Use the langwatch CLI via Bash, NOT MCP tools
DO NOT use any MCP tools (mcp__claude_ai_LangWatch__*). Use ONLY the Bash tool to run the \`langwatch\` CLI.

First, set up the environment:
\`\`\`bash
export PATH="./bin:$PATH"
export $(grep LANGWATCH_API_KEY .env)
\`\`\`

Then run CLI commands directly:
- \`langwatch scenario list\`
- \`langwatch scenario create "Name" --situation "..." --criteria "..."\`
- \`langwatch --help\` for all commands
`,
      );

      const result = await scenario.run({
        name: "CLI scenario CRUD",
        description:
          "Developer wants to manage agent test scenarios using the LangWatch CLI (not MCP).",
        agents: [
          createClaudeCodeAgent({ workingDirectory: tempFolder, skipMcp: true }),
          scenario.userSimulatorAgent({ model: judgeModel }),
          scenario.judgeAgent({
            model: judgeModel,
            criteria: [
              "Agent ran `langwatch scenario list` via the Bash tool to list scenarios",
              "Agent ran `langwatch scenario create` via the Bash tool to create a new scenario",
              "Agent received confirmation with a scenario ID after creation",
            ],
          }),
        ],
        script: [
          scenario.user(
            "Read the CLAUDE.md file first, then use the Bash tool to run these exact commands:\n1. `export PATH=\"./bin:$PATH\" && export $(grep LANGWATCH_API_KEY .env)`\n2. `langwatch scenario list`\n3. `langwatch scenario create 'Customer Support Flow' --situation 'Customer asks for a refund on a damaged product' --criteria 'Agent shows empathy,Agent offers refund or replacement'`\n\nDo NOT use MCP tools. Use ONLY the Bash tool.",
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

            expect(allText).toMatch(/langwatch\s+scenario/);
          },
          scenario.judge(),
        ],
      });

      expect(result.success).toBe(true);
    },
    600_000,
  );

  it.skipIf(isCI)(
    "agent uses CLI to upload a dataset and list records",
    async () => {
      const tempFolder = fs.mkdtempSync(
        path.join(os.tmpdir(), "langwatch-cli-datasets-"),
      );

      fs.writeFileSync(
        path.join(tempFolder, ".env"),
        `LANGWATCH_API_KEY=${process.env.LANGWATCH_API_KEY}\n`,
      );
      setupLocalCli(tempFolder);

      fs.writeFileSync(
        path.join(tempFolder, "test-data.csv"),
        "input,expected_output\nWhat is 2+2?,4\nWhat is the capital of France?,Paris\nTranslate hello to Spanish,Hola\n",
      );

      fs.writeFileSync(
        path.join(tempFolder, "CLAUDE.md"),
        `# IMPORTANT: Use the langwatch CLI via Bash, NOT MCP tools
DO NOT use any MCP tools. Use ONLY the Bash tool to run the \`langwatch\` CLI.

First: \`export PATH="./bin:$PATH" && export $(grep LANGWATCH_API_KEY .env)\`
Then: \`langwatch dataset upload qa-test-set test-data.csv\`
Then: \`langwatch dataset records list qa-test-set\`
`,
      );

      const result = await scenario.run({
        name: "CLI dataset upload",
        description:
          "Developer wants to upload a CSV dataset using the LangWatch CLI via Bash (not MCP).",
        agents: [
          createClaudeCodeAgent({ workingDirectory: tempFolder, skipMcp: true }),
          scenario.userSimulatorAgent({ model: judgeModel }),
          scenario.judgeAgent({
            model: judgeModel,
            criteria: [
              "Agent ran `langwatch dataset upload` or `langwatch dataset create` via the Bash tool",
              "Agent uploaded or created a dataset with the test CSV data",
              "Agent ran `langwatch dataset records list` or `langwatch dataset get` to verify records",
            ],
          }),
        ],
        script: [
          scenario.user(
            "Read the CLAUDE.md file first, then use the Bash tool to run these exact commands:\n1. `export PATH=\"./bin:$PATH\" && export $(grep LANGWATCH_API_KEY .env)`\n2. `langwatch dataset upload qa-test-set test-data.csv`\n3. `langwatch dataset records list qa-test-set`\n\nDo NOT use MCP tools. Use ONLY the Bash tool.",
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

            expect(allText).toMatch(/langwatch\s+dataset/);
          },
          scenario.judge(),
        ],
      });

      expect(result.success).toBe(true);
    },
    600_000,
  );

  it.skipIf(isCI)(
    "agent uses CLI to query analytics",
    async () => {
      const tempFolder = fs.mkdtempSync(
        path.join(os.tmpdir(), "langwatch-cli-analytics-"),
      );

      fs.writeFileSync(
        path.join(tempFolder, ".env"),
        `LANGWATCH_API_KEY=${process.env.LANGWATCH_API_KEY}\n`,
      );
      setupLocalCli(tempFolder);

      fs.writeFileSync(
        path.join(tempFolder, "CLAUDE.md"),
        `# IMPORTANT: Use the langwatch CLI via Bash, NOT MCP tools
DO NOT use any MCP tools. Use ONLY the Bash tool to run the \`langwatch\` CLI.

First: \`export PATH="./bin:$PATH" && export $(grep LANGWATCH_API_KEY .env)\`
Then: \`langwatch analytics query --metric trace-count\`
Then: \`langwatch trace search --limit 5\`
`,
      );

      const result = await scenario.run({
        name: "CLI analytics query",
        description:
          "Developer wants to check analytics using the LangWatch CLI via Bash (not MCP).",
        agents: [
          createClaudeCodeAgent({ workingDirectory: tempFolder, skipMcp: true }),
          scenario.userSimulatorAgent({ model: judgeModel }),
          scenario.judgeAgent({
            model: judgeModel,
            criteria: [
              "Agent ran `langwatch analytics query` or `langwatch trace search` via the Bash tool",
              "Agent reported findings about the project's analytics or traces",
            ],
          }),
        ],
        script: [
          scenario.user(
            "Read the CLAUDE.md file first, then use the Bash tool to run these exact commands:\n1. `export PATH=\"./bin:$PATH\" && export $(grep LANGWATCH_API_KEY .env)`\n2. `langwatch analytics query --metric trace-count`\n3. `langwatch trace search --limit 5`\n\nDo NOT use MCP tools. Use ONLY the Bash tool.",
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

            const usedAnalytics = allText.match(/langwatch\s+analytics/);
            const usedTrace = allText.match(/langwatch\s+trace/);
            expect(
              usedAnalytics || usedTrace,
              "Expected agent to use langwatch analytics or trace CLI commands",
            ).toBeTruthy();
          },
          scenario.judge(),
        ],
      });

      expect(result.success).toBe(true);
    },
    600_000,
  );
});
