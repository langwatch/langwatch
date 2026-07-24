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
  SKILL_TESTS_SET_ID,
} from "./helpers/claude-code-adapter";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, "../.env") });

const isCI = !!process.env.CI;
const judgeModel = openai("gpt-5-mini");

describe("LangWatch CLI Projects & API Keys — Agent Usability", () => {
  it.skipIf(isCI)(
    "agent uses CLI to list and create projects",
    async () => {
      const tempFolder = fs.mkdtempSync(
        path.join(os.tmpdir(), "langwatch-cli-projects-"),
      );

      fs.writeFileSync(
        path.join(tempFolder, ".env"),
        [
          `LANGWATCH_API_KEY=${process.env.LANGWATCH_API_KEY ?? ""}`,
          process.env.LANGWATCH_ENDPOINT
            ? `LANGWATCH_ENDPOINT=${process.env.LANGWATCH_ENDPOINT}`
            : "",
        ]
          .filter(Boolean)
          .join("\n") + "\n",
      );
      setupLocalCli(tempFolder);

      fs.writeFileSync(
        path.join(tempFolder, "CLAUDE.md"),
        `# IMPORTANT: Use the langwatch CLI via Bash, NOT MCP tools
DO NOT use any MCP tools (mcp__claude_ai_LangWatch__*). Use ONLY the Bash tool to run the \`langwatch\` CLI.

First, set up the environment:
\`\`\`bash
export PATH="./bin:$PATH"
export $(grep LANGWATCH_API_KEY .env)
${process.env.LANGWATCH_ENDPOINT ? `export $(grep LANGWATCH_ENDPOINT .env)` : ""}
\`\`\`

Then run CLI commands directly:
- \`langwatch projects list\`
- \`langwatch projects create --name "Test" --language python --framework langchain --new-team-name "Team"\`
`,
      );

      const result = await scenario.run({
        setId: SKILL_TESTS_SET_ID,
        name: "CLI projects lifecycle",
        description:
          "Developer wants to list and create projects using the LangWatch CLI (not MCP).",
        agents: [
          createClaudeCodeAgent({ workingDirectory: tempFolder }),
          scenario.userSimulatorAgent({ model: judgeModel }),
          scenario.judgeAgent({
            model: judgeModel,
            criteria: [
              "Agent ran `langwatch projects list` via the Bash tool",
              "Agent ran `langwatch projects create` with --name, --language, --framework, and --new-team-name flags",
              "Agent received a service API key in the create output",
            ],
          }),
        ],
        script: [
          scenario.user(
            'Read the CLAUDE.md file first, then use the Bash tool to run these exact commands:\n1. `export PATH="./bin:$PATH" && export $(grep LANGWATCH_API_KEY .env)`\n2. `langwatch projects list`\n3. `langwatch projects create --name "CLI Test Project" --language python --framework langchain --new-team-name "CLI Team"`\n\nDo NOT use MCP tools. Use ONLY the Bash tool.',
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

            expect(allText).toMatch(/langwatch\s+projects/);
          },
          scenario.judge(),
        ],
      });

      expect(result.success).toBe(true);
    },
    900_000,
  );

  it.skipIf(isCI)(
    "agent uses CLI to list and create API keys",
    async () => {
      const tempFolder = fs.mkdtempSync(
        path.join(os.tmpdir(), "langwatch-cli-api-keys-"),
      );

      fs.writeFileSync(
        path.join(tempFolder, ".env"),
        [
          `LANGWATCH_API_KEY=${process.env.LANGWATCH_API_KEY ?? ""}`,
          process.env.LANGWATCH_ENDPOINT
            ? `LANGWATCH_ENDPOINT=${process.env.LANGWATCH_ENDPOINT}`
            : "",
        ]
          .filter(Boolean)
          .join("\n") + "\n",
      );
      setupLocalCli(tempFolder);

      fs.writeFileSync(
        path.join(tempFolder, "CLAUDE.md"),
        `# IMPORTANT: Use the langwatch CLI via Bash, NOT MCP tools
DO NOT use any MCP tools. Use ONLY the Bash tool to run the \`langwatch\` CLI.

First: \`export PATH="./bin:$PATH" && export $(grep LANGWATCH_API_KEY .env)\`
${process.env.LANGWATCH_ENDPOINT ? `And: \`export $(grep LANGWATCH_ENDPOINT .env)\`` : ""}
Then: \`langwatch api-keys list\`
Then: \`langwatch api-keys create --name "CI Deploy Key"\`
`,
      );

      const result = await scenario.run({
        setId: SKILL_TESTS_SET_ID,
        name: "CLI API keys lifecycle",
        description:
          "Developer wants to list and create API keys using the LangWatch CLI (not MCP).",
        agents: [
          createClaudeCodeAgent({ workingDirectory: tempFolder }),
          scenario.userSimulatorAgent({ model: judgeModel }),
          scenario.judgeAgent({
            model: judgeModel,
            criteria: [
              "Agent ran `langwatch api-keys list` via the Bash tool",
              "Agent ran `langwatch api-keys create` with a --name flag",
              "Agent received a token in the create output",
            ],
          }),
        ],
        script: [
          scenario.user(
            'Read the CLAUDE.md file first, then use the Bash tool to run these exact commands:\n1. `export PATH="./bin:$PATH" && export $(grep LANGWATCH_API_KEY .env)`\n2. `langwatch api-keys list`\n3. `langwatch api-keys create --name "CI Deploy Key"`\n\nDo NOT use MCP tools. Use ONLY the Bash tool.',
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

            expect(allText).toMatch(/langwatch\s+api-keys/);
          },
          scenario.judge(),
        ],
      });

      expect(result.success).toBe(true);
    },
    900_000,
  );
});
