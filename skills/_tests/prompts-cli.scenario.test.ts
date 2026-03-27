import scenario, { type ScenarioExecutionStateLike } from "@langwatch/scenario";
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
} from "./helpers/claude-code-adapter";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, "../.env") });

const isCI = !!process.env.CI;
const judgeModel = openai("gpt-5-mini");

function assertNoInteractiveWorkarounds(
  state: ScenarioExecutionStateLike
): void {
  const allText = state.messages
    .map((m) =>
      typeof m.content === "string" ? m.content : JSON.stringify(m.content)
    )
    .join("\n");

  // Agent should not need to pipe yes, use expect, or hack around interactive prompts
  expect(allText).not.toMatch(/echo\s+["']?[yY](?:es)?["']?\s*\|/);
  expect(allText).not.toMatch(/\byes\s*\|/);
  expect(allText).not.toMatch(/expect\s+-c/);
  expect(allText).not.toMatch(/printf\s+["']\\n["']\s*\|/);
}

describe("LangWatch Prompts CLI — Agent Usability", () => {
  it.skipIf(isCI)(
    "agent discovers and uses CLI to version prompts from scratch",
    async () => {
      const tempFolder = fs.mkdtempSync(
        path.join(os.tmpdir(), "langwatch-cli-prompts-version-")
      );

      execSync(
        `cp -r ${path.resolve(__dirname, "fixtures/cli-prompts/python-with-prompts")}/* ${tempFolder}/`
      );

      fs.writeFileSync(
        path.join(tempFolder, ".env"),
        `LANGWATCH_API_KEY=${process.env.LANGWATCH_API_KEY}\n`
      );

      const result = await scenario.run({
        name: "CLI prompt versioning from scratch",
        description:
          "Developer has a Python project with hardcoded prompts and wants to use the LangWatch Prompts CLI to version them.",
        agents: [
          createClaudeCodeAgent({ workingDirectory: tempFolder }),
          scenario.userSimulatorAgent({ model: judgeModel }),
          scenario.judgeAgent({
            model: judgeModel,
            criteria: [
              "Agent used the langwatch prompt CLI commands (like langwatch prompt init, langwatch prompt create)",
              "Agent did not get stuck on any interactive prompts or need to hack around them",
            ],
          }),
        ],
        script: [
          scenario.user(
            "use the langwatch prompt cli to version my prompts. The langwatch cli is already installed globally via npm. Check the docs via the LangWatch MCP if needed."
          ),
          scenario.agent(),
          (state) => {
            toolCallFix(state);

            expect(
              fs.existsSync(path.join(tempFolder, "prompts.json")),
              "Expected prompts.json to exist after langwatch prompt init"
            ).toBe(true);

            const promptsDir = path.join(tempFolder, "prompts");
            const hasYaml =
              fs.existsSync(promptsDir) &&
              fs
                .readdirSync(promptsDir)
                .some(
                  (f) =>
                    f.endsWith(".prompt.yaml") || f.endsWith(".prompt.yml")
                );
            expect(
              hasYaml,
              "Expected at least one .prompt.yaml file in prompts/"
            ).toBe(true);

            assertNoInteractiveWorkarounds(state);
          },
          scenario.judge(),
        ],
      });

      expect(result.success).toBe(true);
    },
    600_000
  );

  it.skipIf(isCI)(
    "agent creates a specific named prompt via CLI",
    async () => {
      const tempFolder = fs.mkdtempSync(
        path.join(os.tmpdir(), "langwatch-cli-prompts-create-")
      );

      fs.writeFileSync(
        path.join(tempFolder, ".env"),
        `LANGWATCH_API_KEY=${process.env.LANGWATCH_API_KEY}\n`
      );
      fs.writeFileSync(
        path.join(tempFolder, "prompts.json"),
        JSON.stringify({ prompts: {} })
      );
      fs.writeFileSync(
        path.join(tempFolder, "prompts-lock.json"),
        JSON.stringify({ lockfileVersion: 1, prompts: {} })
      );
      fs.mkdirSync(path.join(tempFolder, "prompts"), { recursive: true });

      const result = await scenario.run({
        name: "CLI create specific prompt",
        description:
          "Developer wants to create a new prompt called refund-handler for customer refund requests using the CLI.",
        agents: [
          createClaudeCodeAgent({ workingDirectory: tempFolder }),
          scenario.userSimulatorAgent({ model: judgeModel }),
          scenario.judgeAgent({
            model: judgeModel,
            criteria: [
              "Agent created a prompt using the langwatch prompt create command",
              "Agent edited the prompt YAML to include refund-related instructions",
            ],
          }),
        ],
        script: [
          scenario.user(
            "create a new prompt called refund-handler for handling customer refund requests using the langwatch prompt cli. Edit the YAML to have a good system prompt for it. The cli is already installed globally."
          ),
          scenario.agent(),
          (state) => {
            toolCallFix(state);

            const promptsDir = path.join(tempFolder, "prompts");
            const yamlFiles = fs.existsSync(promptsDir)
              ? fs
                  .readdirSync(promptsDir)
                  .filter(
                    (f) =>
                      f.endsWith(".prompt.yaml") || f.endsWith(".prompt.yml")
                  )
              : [];
            expect(yamlFiles.length).toBeGreaterThan(0);

            const content = yamlFiles
              .map((f) =>
                fs.readFileSync(path.join(promptsDir, f), "utf8")
              )
              .join("\n");
            expect(content.toLowerCase()).toMatch(/refund/);

            assertNoInteractiveWorkarounds(state);
          },
          scenario.judge(),
        ],
      });

      expect(result.success).toBe(true);
    },
    600_000
  );

  it.skipIf(isCI)(
    "agent uses push --force-local to resolve conflicts non-interactively",
    async () => {
      const tempFolder = fs.mkdtempSync(
        path.join(os.tmpdir(), "langwatch-cli-prompts-push-")
      );

      // Set up a project with a prompt that exists both locally and remotely (simulate conflict scenario)
      fs.writeFileSync(
        path.join(tempFolder, ".env"),
        `LANGWATCH_API_KEY=${process.env.LANGWATCH_API_KEY}\n`
      );
      fs.writeFileSync(
        path.join(tempFolder, "prompts.json"),
        JSON.stringify({ prompts: {} })
      );
      fs.writeFileSync(
        path.join(tempFolder, "prompts-lock.json"),
        JSON.stringify({ lockfileVersion: 1, prompts: {} })
      );
      fs.mkdirSync(path.join(tempFolder, "prompts"), { recursive: true });

      const result = await scenario.run({
        name: "CLI push with force-local flag",
        description:
          "Agent creates a prompt and pushes it to the platform. If there are conflicts, it should use --force-local to resolve them automatically.",
        agents: [
          createClaudeCodeAgent({ workingDirectory: tempFolder }),
          scenario.userSimulatorAgent({ model: judgeModel }),
          scenario.judgeAgent({
            model: judgeModel,
            criteria: [
              "Agent created a prompt using the langwatch CLI",
              "Agent pushed the prompt to the platform (using langwatch prompt push or langwatch prompt sync)",
              "If conflicts occurred, agent used --force-local or --force-remote flag instead of getting stuck on interactive prompts",
            ],
          }),
        ],
        script: [
          scenario.user(
            "create a new prompt called greeting-bot using the langwatch prompt cli, then push it to the platform. If there are any conflicts during push, use the --force-local flag. The cli is already installed globally."
          ),
          scenario.agent(),
          (state) => {
            toolCallFix(state);

            // Verify prompt was created
            const promptsDir = path.join(tempFolder, "prompts");
            const yamlFiles = fs.existsSync(promptsDir)
              ? fs
                  .readdirSync(promptsDir)
                  .filter((f) => f.endsWith(".prompt.yaml"))
              : [];
            expect(yamlFiles.length).toBeGreaterThan(0);

            // Verify no interactive workarounds
            assertNoInteractiveWorkarounds(state);
          },
          scenario.judge(),
        ],
      });
      expect(result.success).toBe(true);
    },
    600_000
  );
});
