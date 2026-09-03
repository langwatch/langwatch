import scenario from "@langwatch/scenario";
import { spawnSync } from "child_process";
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

/**
 * Whether this machine can reach the organization API of LangWatch.
 *
 * `langwatch api-keys` manages the keys of an organization, so it refuses a
 * project API key and reads the credential of `langwatch login` instead. The
 * scenario below therefore runs on the login of the developer, and skips when
 * there is none, the same way the rest of this suite skips without keys.
 */
function hasOrganizationLogin(): boolean {
  const cliPath = path.resolve(__dirname, "../../sdks/typescript/dist/cli/index.js");
  if (!fs.existsSync(cliPath)) return false;
  const env = { ...process.env };
  delete env.LANGWATCH_API_KEY;
  // A directory of its own: the CLI reads the .env of its working directory,
  // and skills/.env carries the project key this probe must not see.
  const probeDir = fs.mkdtempSync(path.join(os.tmpdir(), "langwatch-org-probe-"));
  try {
    const probe = spawnSync(process.execPath, [cliPath, "api-keys", "list"], {
      cwd: probeDir,
      env,
      encoding: "utf-8",
      stdio: ["ignore", "ignore", "ignore"],
      // A binary that hangs must not hold the whole file: the probe only
      // reads one short list, so 15 seconds is already generous.
      timeout: 15_000,
    });
    return probe.status === 0;
  } finally {
    fs.rmSync(probeDir, { recursive: true, force: true });
  }
}

/** Runs the CLI on the organization login, away from any project key. */
function runOnOrganizationLogin(args: string[]): string {
  const cliPath = path.resolve(__dirname, "../../sdks/typescript/dist/cli/index.js");
  const env = { ...process.env };
  delete env.LANGWATCH_API_KEY;
  const workDir = fs.mkdtempSync(path.join(os.tmpdir(), "langwatch-org-cli-"));
  try {
    const run = spawnSync(process.execPath, [cliPath, ...args], {
      cwd: workDir,
      env,
      encoding: "utf-8",
      timeout: 30_000,
    });
    return run.stdout ?? "";
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
}

/**
 * Archives the project the scenario asked the agent to create.
 *
 * Every run of this scenario adds a real project to the organization, so
 * without this the dogfood suite fills the account with them.
 */
function archiveProjectsNamed(name: string): void {
  let projects: Array<{ id: string; name: string }> = [];
  try {
    const listed = JSON.parse(runOnOrganizationLogin(["projects", "list"]));
    projects = Array.isArray(listed) ? listed : (listed.data ?? []);
  } catch {
    return;
  }
  for (const project of projects.filter((row) => row.name === name)) {
    runOnOrganizationLogin(["projects", "delete", project.id]);
  }
}

describe("LangWatch CLI Projects & API Keys — Agent Usability", () => {
  // One organization login serves both cases; each case then drives the
  // CLI for one resource.
  describe("given the CLI is logged in to an organization", () => {
    describe("when the agent lists and creates projects", () => {
      it.skipIf(isCI || !hasOrganizationLogin())(
        "agent uses CLI to list and create projects",
        async () => {
          const tempFolder = fs.mkdtempSync(path.join(os.tmpdir(), "langwatch-cli-projects-"));
          const projectName = `CLI Test Project ${Date.now()}`;

          fs.writeFileSync(
            path.join(tempFolder, ".env"),
            process.env.LANGWATCH_ENDPOINT
              ? `LANGWATCH_ENDPOINT=${process.env.LANGWATCH_ENDPOINT}\n`
              : "",
          );
          setupLocalCli(tempFolder);

          // No project key here on purpose: `projects` reaches the organization,
          // refuses a project key, and reads the credential of `langwatch login`.
          fs.writeFileSync(
            path.join(tempFolder, "CLAUDE.md"),
            `# IMPORTANT: Use the langwatch CLI via Bash, NOT MCP tools
    DO NOT use any MCP tools (mcp__claude_ai_LangWatch__*). Use ONLY the Bash tool to run the \`langwatch\` CLI.

    \`projects\` manages the projects of the whole organization, so it uses the
    credential of \`langwatch login\`. Do not set LANGWATCH_API_KEY: a project key
    is refused on these commands.

    First, set up the environment:
    \`\`\`bash
    export PATH="./bin:$PATH"
    ${process.env.LANGWATCH_ENDPOINT ? `export $(grep LANGWATCH_ENDPOINT .env)` : ""}
    \`\`\`

    Then run CLI commands directly:
    - \`langwatch projects list\`
    - \`langwatch projects create --name "${projectName}" --language python --framework langchain --new-team-name "CLI Team"\`
    `,
          );

          try {
            const result = await scenario.run({
              setId: SKILL_TESTS_SET_ID,
              name: "CLI projects lifecycle",
              description:
                "Developer wants to list and create projects using the LangWatch CLI (not MCP).",
              agents: [
                createClaudeCodeAgent({
                  workingDirectory: tempFolder,
                  omitEnvKeys: ["LANGWATCH_API_KEY"],
                }),
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
                  `Read the CLAUDE.md file first, then use the Bash tool to run these exact commands:\n1. \`export PATH="./bin:$PATH"\`\n2. \`langwatch projects list\`\n3. \`langwatch projects create --name "${projectName}" --language python --framework langchain --new-team-name "CLI Team"\`\n\nDo NOT use MCP tools. Use ONLY the Bash tool. Do NOT set LANGWATCH_API_KEY.`,
                ),
                scenario.agent(),
                (state) => {
                  toolCallFix(state);

                  const allText = state.messages
                    .map((m) =>
                      typeof m.content === "string" ? m.content : JSON.stringify(m.content),
                    )
                    .join("\n");

                  expect(allText).toMatch(/langwatch\s+projects/);
                },
                scenario.judge(),
              ],
            });

            expect(result.success).toBe(true);
          } finally {
            archiveProjectsNamed(projectName);
          }
        },
        900_000,
      );
    });

    describe("when the agent lists and creates API keys", () => {
      it.skipIf(isCI || !hasOrganizationLogin())(
        "agent uses CLI to list and create API keys",
        async () => {
          const tempFolder = fs.mkdtempSync(path.join(os.tmpdir(), "langwatch-cli-api-keys-"));

          fs.writeFileSync(
            path.join(tempFolder, ".env"),
            process.env.LANGWATCH_ENDPOINT
              ? `LANGWATCH_ENDPOINT=${process.env.LANGWATCH_ENDPOINT}\n`
              : "",
          );
          setupLocalCli(tempFolder);

          // No project key here on purpose: `api-keys` reaches the organization,
          // refuses a project key, and reads the credential of `langwatch login`.
          fs.writeFileSync(
            path.join(tempFolder, "CLAUDE.md"),
            `# IMPORTANT: Use the langwatch CLI via Bash, NOT MCP tools
    DO NOT use any MCP tools. Use ONLY the Bash tool to run the \`langwatch\` CLI.

    \`api-keys\` manages the keys of the whole organization, so it uses the
    credential of \`langwatch login\`. Do not set LANGWATCH_API_KEY: a project key
    is refused on these commands.

    First: \`export PATH="./bin:$PATH"\`
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
              createClaudeCodeAgent({
                workingDirectory: tempFolder,
                omitEnvKeys: ["LANGWATCH_API_KEY"],
              }),
              scenario.userSimulatorAgent({ model: judgeModel }),
              scenario.judgeAgent({
                model: judgeModel,
                criteria: [
                  "Agent ran `langwatch api-keys list` via the Bash tool",
                  "Agent ran `langwatch api-keys create` with a --name flag",
                  "Agent reported what the create command answered, either the token it returned or the permission the credential lacks, and did not invent a key",
                ],
              }),
            ],
            script: [
              scenario.user(
                'Read the CLAUDE.md file first, then use the Bash tool to run these exact commands:\n1. `export PATH="./bin:$PATH"`\n2. `langwatch api-keys list`\n3. `langwatch api-keys create --name "CI Deploy Key"`\n\nDo NOT use MCP tools. Use ONLY the Bash tool. Do NOT set LANGWATCH_API_KEY.',
              ),
              scenario.agent(),
              (state) => {
                toolCallFix(state);

                const allText = state.messages
                  .map((m) =>
                    typeof m.content === "string" ? m.content : JSON.stringify(m.content),
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
  });
});
