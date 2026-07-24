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

const gatewayEnv = `LANGWATCH_API_KEY=${process.env.LANGWATCH_API_KEY}\n${process.env.LANGWATCH_ENDPOINT ? `LANGWATCH_ENDPOINT=${process.env.LANGWATCH_ENDPOINT}\n` : ""}${process.env.LANGWATCH_GATEWAY_GPC_ID ? `LANGWATCH_GATEWAY_GPC_ID=${process.env.LANGWATCH_GATEWAY_GPC_ID}\n` : ""}`;

describe("LangWatch AI Gateway CLI — Agent Usability", () => {
  it.skipIf(isCI)(
    "agent uses CLI to mint, list, rotate, and revoke a virtual key",
    async () => {
      const tempFolder = fs.mkdtempSync(
        path.join(os.tmpdir(), "langwatch-cli-gateway-vk-"),
      );

      fs.writeFileSync(path.join(tempFolder, ".env"), gatewayEnv);
      setupLocalCli(tempFolder);

      fs.writeFileSync(
        path.join(tempFolder, "CLAUDE.md"),
        `# Managing AI Gateway virtual keys — CLI only
DO NOT use any MCP tools (mcp__claude_ai_LangWatch__*). Use ONLY the Bash tool.

Setup:
\`\`\`bash
export PATH="./bin:$PATH"
export $(grep LANGWATCH_API_KEY .env)
\`\`\`

Workflow to exercise (in order):
1. \`langwatch virtual-keys list\` — confirm CLI is authenticated.
2. \`langwatch gateway-providers list\` — find an existing provider binding id (or report one is needed).
3. If a provider id is available (env \`LANGWATCH_GATEWAY_GPC_ID\` OR first row of gateway-providers list): run \`langwatch virtual-keys create --name "scenario-dogfood-<timestamp>" --description "from scenario test" --environment test --provider <gpc_id> --format json\` — capture the vk_id + secret from the JSON output.
4. \`langwatch virtual-keys get <vk_id>\` — verify the VK exists and is ACTIVE.
5. \`langwatch virtual-keys rotate <vk_id>\` — capture the new secret.
6. \`langwatch virtual-keys revoke <vk_id>\` — revoke the VK.
7. \`langwatch virtual-keys get <vk_id>\` — verify status is REVOKED.

If step 3's prerequisite (a provider binding) is missing, stop gracefully with \`gateway-providers list\` output and explain that a \`gpc_*\` id is required in \`LANGWATCH_GATEWAY_GPC_ID\` or must be created via \`gateway-providers create\`.
`,
      );

      const result = await scenario.run({
        setId: SKILL_TESTS_SET_ID,
        name: "CLI virtual-keys lifecycle",
        description:
          "Developer mints, rotates, and revokes a LangWatch AI Gateway virtual key end-to-end via the langwatch CLI.",
        agents: [
          createClaudeCodeAgent({ workingDirectory: tempFolder }),
          scenario.userSimulatorAgent({ model: judgeModel }),
          scenario.judgeAgent({
            model: judgeModel,
            criteria: [
              "Agent ran `langwatch virtual-keys list` to confirm CLI auth",
              "Agent ran `langwatch gateway-providers list` to discover a provider binding id",
              "Agent either created a VK successfully OR explained cleanly that a provider binding was needed with instructions to set LANGWATCH_GATEWAY_GPC_ID",
              "If a VK was created, the agent then called rotate and revoke on it",
            ],
          }),
        ],
        script: [
          scenario.user(
            "Read the CLAUDE.md file first, then follow the workflow via the Bash tool. Do NOT use any MCP tools.",
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

            expect(allText).toMatch(/langwatch\s+virtual-keys\s+list/);
            expect(allText).toMatch(/langwatch\s+gateway-providers\s+list/);
          },
          scenario.judge(),
        ],
      });

      expect(result.success).toBe(true);
    },
    900_000,
  );

  it.skipIf(isCI)(
    "agent uses CLI to create a budget with a project scope and archive it",
    async () => {
      const tempFolder = fs.mkdtempSync(
        path.join(os.tmpdir(), "langwatch-cli-gateway-budget-"),
      );

      fs.writeFileSync(path.join(tempFolder, ".env"), gatewayEnv);
      setupLocalCli(tempFolder);

      fs.writeFileSync(
        path.join(tempFolder, "CLAUDE.md"),
        `# Managing AI Gateway budgets — CLI only
DO NOT use MCP tools. Use ONLY the Bash tool.

Setup:
\`\`\`bash
export PATH="./bin:$PATH"
export $(grep LANGWATCH_API_KEY .env)
\`\`\`

Workflow:
1. \`langwatch gateway-budgets list\` — confirm CLI auth + baseline state.
2. \`langwatch gateway-budgets create --scope project --name "scenario-dogfood-<timestamp>" --window month --limit 5 --on-breach warn --format json\` — capture budget id.
3. \`langwatch gateway-budgets list\` — verify the new budget appears.
4. \`langwatch gateway-budgets archive <budget_id>\` — archive it.
5. \`langwatch gateway-budgets list\` — verify it no longer appears (or is marked archived).
`,
      );

      const result = await scenario.run({
        setId: SKILL_TESTS_SET_ID,
        name: "CLI gateway-budgets lifecycle",
        description:
          "Developer creates a PROJECT-scoped monthly $5 soft-cap budget, verifies, and archives.",
        agents: [
          createClaudeCodeAgent({ workingDirectory: tempFolder }),
          scenario.userSimulatorAgent({ model: judgeModel }),
          scenario.judgeAgent({
            model: judgeModel,
            criteria: [
              "Agent ran `langwatch gateway-budgets list` at least once",
              "Agent ran `langwatch gateway-budgets create` with --scope project and --window month",
              "Agent ran `langwatch gateway-budgets archive` on the newly-created budget",
            ],
          }),
        ],
        script: [
          scenario.user(
            "Read CLAUDE.md and follow the workflow via Bash. No MCP tools.",
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

            expect(allText).toMatch(/langwatch\s+gateway-budgets\s+create/);
            expect(allText).toMatch(/langwatch\s+gateway-budgets\s+archive/);
          },
          scenario.judge(),
        ],
      });

      expect(result.success).toBe(true);
    },
    900_000,
  );

  it.skipIf(isCI)(
    "agent discovers gateway CLI surface via --help",
    async () => {
      const tempFolder = fs.mkdtempSync(
        path.join(os.tmpdir(), "langwatch-cli-gateway-help-"),
      );

      fs.writeFileSync(path.join(tempFolder, ".env"), gatewayEnv);
      setupLocalCli(tempFolder);

      fs.writeFileSync(
        path.join(tempFolder, "CLAUDE.md"),
        `# Discovering the LangWatch AI Gateway CLI
DO NOT use MCP tools. Use ONLY the Bash tool.

Setup: \`export PATH="./bin:$PATH" && export $(grep LANGWATCH_API_KEY .env)\`

Explore the CLI via \`--help\`. In order:
1. \`langwatch --help\` — top-level command inventory.
2. \`langwatch virtual-keys --help\` (alias \`vk\`) — VK subcommands.
3. \`langwatch gateway-budgets --help\` — budget subcommands.
4. \`langwatch gateway-providers --help\` — provider-binding subcommands.

Your goal: report back which top-level command groups are available and what the \`virtual-keys create\` accepts as options.
`,
      );

      const result = await scenario.run({
        setId: SKILL_TESTS_SET_ID,
        name: "CLI gateway surface discovery via --help",
        description:
          "Developer who's never used the gateway CLI discovers the surface using --help only.",
        agents: [
          createClaudeCodeAgent({ workingDirectory: tempFolder }),
          scenario.userSimulatorAgent({ model: judgeModel }),
          scenario.judgeAgent({
            model: judgeModel,
            criteria: [
              "Agent discovered the three gateway command groups: virtual-keys, gateway-budgets, gateway-providers",
              "Agent reported back the options available on `virtual-keys create` (at minimum --name, --provider)",
              "Agent did NOT invoke any command that mutated state",
            ],
          }),
        ],
        script: [
          scenario.user(
            "Read CLAUDE.md and follow the workflow via Bash. No MCP tools. No mutation commands.",
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

            expect(allText).toMatch(/virtual-keys.*--help|--help.*virtual-keys/);
            expect(allText).toMatch(/gateway-budgets/);
            expect(allText).toMatch(/gateway-providers/);
          },
          scenario.judge(),
        ],
      });

      expect(result.success).toBe(true);
    },
    900_000,
  );
});
