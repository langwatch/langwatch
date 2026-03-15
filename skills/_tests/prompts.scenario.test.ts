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
} from "./helpers/claude-code-adapter";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, "../.env") });

const isCI = !!process.env.CI;

const judgeModel = openai("gpt-5-mini");

function copySkillToWorkDir(tempFolder: string) {
  const skillDir = path.join(tempFolder, ".skills", "prompts");
  fs.mkdirSync(skillDir, { recursive: true });
  fs.copyFileSync(
    path.resolve(__dirname, "../prompts/SKILL.md"),
    path.join(skillDir, "SKILL.md")
  );
  const sharedDir = path.join(skillDir, "_shared");
  fs.mkdirSync(sharedDir, { recursive: true });
  execSync(
    `cp -r ${path.resolve(__dirname, "../_shared")}/* ${sharedDir}/`
  );
}

function findFiles(dir: string, pattern: RegExp): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (
      entry.isDirectory() &&
      entry.name !== "node_modules" &&
      entry.name !== ".venv"
    ) {
      results.push(...findFiles(fullPath, pattern));
    } else if (entry.isFile() && pattern.test(entry.name)) {
      results.push(fullPath);
    }
  }
  return results;
}

describe("Prompts Skill", () => {
  it.skipIf(isCI)(
    "versions prompts in a Python OpenAI bot with LangWatch Prompts CLI",
    async () => {
      const tempFolder = fs.mkdtempSync(
        path.join(os.tmpdir(), "langwatch-skill-prompt-versioning-py-")
      );

      execSync(
        `cp -r ${path.resolve(__dirname, "fixtures/python-openai")}/* ${tempFolder}/`
      );
      copySkillToWorkDir(tempFolder);

      const result = await scenario.run({
        name: "Python OpenAI prompt versioning",
        description:
          "Setting up prompt versioning in a Python OpenAI bot project using the LangWatch Prompts CLI.",
        agents: [
          createClaudeCodeAgent({ workingDirectory: tempFolder }),
          scenario.userSimulatorAgent({ model: judgeModel }),
          scenario.judgeAgent({
            model: judgeModel,
            criteria: [
              "Agent set up prompt versioning using the LangWatch Prompts CLI",
              "Agent should use the LangWatch MCP to check documentation",
            ],
          }),
        ],
        script: [
          scenario.user(
            "version my agent prompts with langwatch, short and sweet, no need to test the changes"
          ),
          scenario.agent(),
          (state) => {
            toolCallFix(state);

            // Verify the agent modified main.py to use langwatch prompts
            const mainPy = fs.readFileSync(
              path.join(tempFolder, "main.py"),
              "utf8"
            );
            expect(mainPy).toContain("langwatch");

            // Check for prompt management setup — either CLI artifacts or manual prompt files
            const hasPromptsJson = fs.existsSync(path.join(tempFolder, "prompts.json"));
            const promptsDir = path.join(tempFolder, "prompts");
            const hasPromptsDir = fs.existsSync(promptsDir);
            const promptYamlFiles = hasPromptsDir ? findFiles(promptsDir, /\.ya?ml$/) : [];

            // At least one of: prompts.json, prompt yaml files, or code referencing prompts.get
            const codeUsesPromptsGet = /prompts?\.(get|pull|compile)/.test(mainPy);
            expect(
              hasPromptsJson || promptYamlFiles.length > 0 || codeUsesPromptsGet,
              "Expected prompt management setup: prompts.json, prompt YAML files, or code using prompts.get()"
            ).toBe(true);
          },
          scenario.judge(),
        ],
      });

      expect(result.success).toBe(true);
    },
    600_000
  );
});
