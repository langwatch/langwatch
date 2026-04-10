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
  assertSkillWasRead,
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
            "version my agent prompts with langwatch"
          ),
          scenario.agent(),
          (state) => {
            toolCallFix(state);
            assertSkillWasRead(state, "prompts");

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

  it.skipIf(isCI)(
    "versions prompts in a TypeScript Vercel AI bot",
    async () => {
      const tempFolder = fs.mkdtempSync(
        path.join(os.tmpdir(), "langwatch-skill-prompts-ts-")
      );
      execSync(
        `cp -r ${path.resolve(__dirname, "fixtures/typescript-vercel")}/* ${tempFolder}/`
      );
      copySkillToWorkDir(tempFolder);

      const result = await scenario.run({
        name: "TypeScript Vercel AI prompt versioning",
        description:
          "Setting up prompt versioning in a TypeScript Vercel AI bot project.",
        agents: [
          createClaudeCodeAgent({ workingDirectory: tempFolder }),
          scenario.userSimulatorAgent({ model: judgeModel }),
          scenario.judgeAgent({
            model: judgeModel,
            criteria: [
              "Agent set up prompt versioning using the LangWatch Prompts CLI or SDK",
              "Agent should use the LangWatch MCP to check documentation",
            ],
          }),
        ],
        script: [
          scenario.user(
            "version my agent prompts with langwatch"
          ),
          scenario.agent(),
          (state) => {
            toolCallFix(state);
            assertSkillWasRead(state, "prompts");
            const indexTs = fs.readFileSync(
              `${tempFolder}/index.ts`,
              "utf8"
            );
            expect(indexTs).toContain("langwatch");
            // Check for prompt management setup
            const hasPromptsJson = fs.existsSync(
              path.join(tempFolder, "prompts.json")
            );
            const hasPromptsDir = fs.existsSync(
              path.join(tempFolder, "prompts")
            );
            const codeUsesPrompts = /prompts?\.(get|pull|compile)/.test(
              indexTs
            );
            expect(
              hasPromptsJson || hasPromptsDir || codeUsesPrompts,
              "Expected prompt management setup"
            ).toBe(true);
          },
          scenario.judge(),
        ],
      });
      expect(result.success).toBe(true);
    },
    600_000
  );

  it.skipIf(isCI)(
    "versions prompts in a Python LangGraph agent",
    async () => {
      const tempFolder = fs.mkdtempSync(
        path.join(os.tmpdir(), "langwatch-skill-prompts-langgraph-")
      );
      execSync(
        `cp -r ${path.resolve(__dirname, "fixtures/python-langgraph")}/* ${tempFolder}/`
      );
      copySkillToWorkDir(tempFolder);

      const result = await scenario.run({
        name: "Python LangGraph prompt versioning",
        description:
          "Setting up prompt versioning in a Python LangGraph agent project using the LangWatch Prompts CLI.",
        agents: [
          createClaudeCodeAgent({ workingDirectory: tempFolder }),
          scenario.userSimulatorAgent({ model: judgeModel }),
          scenario.judgeAgent({
            model: judgeModel,
            criteria: [
              "Agent set up prompt versioning using the LangWatch Prompts CLI or SDK",
            ],
          }),
        ],
        script: [
          scenario.user(
            "version my agent prompts with langwatch"
          ),
          scenario.agent(),
          (state) => {
            toolCallFix(state);
            assertSkillWasRead(state, "prompts");

            const mainPy = fs.readFileSync(
              path.join(tempFolder, "main.py"),
              "utf8"
            );
            expect(mainPy).toContain("langwatch");

            const hasPromptsJson = fs.existsSync(
              path.join(tempFolder, "prompts.json")
            );
            const promptsDir = path.join(tempFolder, "prompts");
            const hasPromptsDir = fs.existsSync(promptsDir);
            const promptYamlFiles = hasPromptsDir
              ? findFiles(promptsDir, /\.ya?ml$/)
              : [];
            const codeUsesPromptsGet = /prompts?\.(get|pull|compile)/.test(
              mainPy
            );
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

  it.skipIf(isCI)(
    "versions prompts in a TypeScript Mastra agent",
    async () => {
      const tempFolder = fs.mkdtempSync(
        path.join(os.tmpdir(), "langwatch-skill-prompts-mastra-")
      );
      execSync(
        `cp -r ${path.resolve(__dirname, "fixtures/typescript-mastra")}/* ${tempFolder}/`
      );
      copySkillToWorkDir(tempFolder);

      const result = await scenario.run({
        name: "TypeScript Mastra prompt versioning",
        description:
          "Setting up prompt versioning in a TypeScript Mastra agent project.",
        agents: [
          createClaudeCodeAgent({ workingDirectory: tempFolder }),
          scenario.userSimulatorAgent({ model: judgeModel }),
          scenario.judgeAgent({
            model: judgeModel,
            criteria: [
              "Agent set up prompt versioning using the LangWatch Prompts CLI or SDK",
            ],
          }),
        ],
        script: [
          scenario.user(
            "version my agent prompts with langwatch"
          ),
          scenario.agent(),
          (state) => {
            toolCallFix(state);
            assertSkillWasRead(state, "prompts");

            const indexTs = fs.readFileSync(
              `${tempFolder}/index.ts`,
              "utf8"
            );
            expect(indexTs).toContain("langwatch");

            const hasPromptsJson = fs.existsSync(
              path.join(tempFolder, "prompts.json")
            );
            const hasPromptsDir = fs.existsSync(
              path.join(tempFolder, "prompts")
            );
            const codeUsesPrompts = /prompts?\.(get|pull|compile)/.test(
              indexTs
            );
            expect(
              hasPromptsJson || hasPromptsDir || codeUsesPrompts,
              "Expected prompt management setup"
            ).toBe(true);
          },
          scenario.judge(),
        ],
      });
      expect(result.success).toBe(true);
    },
    600_000
  );

  it.skipIf(isCI)(
    "creates a new prompt version for a specific use case",
    async () => {
      const tempFolder = fs.mkdtempSync(
        path.join(os.tmpdir(), "langwatch-skill-prompts-targeted-")
      );
      execSync(
        `cp -r ${path.resolve(__dirname, "fixtures/python-openai")}/* ${tempFolder}/`
      );
      copySkillToWorkDir(tempFolder);

      const result = await scenario.run({
        name: "Targeted prompt creation",
        description:
          "Adding a new versioned prompt for a specific customer support use case.",
        agents: [
          createClaudeCodeAgent({ workingDirectory: tempFolder }),
          scenario.userSimulatorAgent({ model: judgeModel }),
          scenario.judgeAgent({
            model: judgeModel,
            criteria: [
              "Agent created or modified a prompt specifically for the customer support use case",
              "The prompt is managed through LangWatch (not hardcoded)",
            ],
          }),
        ],
        script: [
          scenario.user(
            "add a new prompt version for handling customer refund requests, it should be empathetic and follow our refund policy, use langwatch prompts CLI to version it"
          ),
          scenario.agent(),
          (state) => {
            toolCallFix(state);
            assertSkillWasRead(state, "prompts");
            const mainPy = fs.readFileSync(`${tempFolder}/main.py`, "utf8");
            // Either the code was updated to use langwatch prompts, or prompt files were created
            const hasPromptsJson = fs.existsSync(
              path.join(tempFolder, "prompts.json")
            );
            const promptsDir = path.join(tempFolder, "prompts");
            const hasPromptsDir = fs.existsSync(promptsDir);
            const hasYaml =
              hasPromptsDir &&
              fs
                .readdirSync(promptsDir)
                .some((f) => f.endsWith(".yaml") || f.endsWith(".yml"));
            const codeUsesPrompts = /langwatch/.test(mainPy);
            expect(
              hasPromptsJson || hasYaml || codeUsesPrompts,
              "Expected some form of prompt management setup"
            ).toBe(true);
          },
          scenario.judge(),
        ],
      });
      expect(result.success).toBe(true);
    },
    600_000
  );

  it.skipIf(isCI)(
    "guides tag-based deployment workflow for Python",
    async () => {
      const tempFolder = fs.mkdtempSync(
        path.join(os.tmpdir(), "langwatch-skill-prompts-tags-py-")
      );

      execSync(
        `cp -r ${path.resolve(__dirname, "fixtures/python-openai")}/* ${tempFolder}/`
      );
      copySkillToWorkDir(tempFolder);

      const result = await scenario.run({
        name: "Python prompt tags deployment",
        description:
          "Setting up tag-based prompt deployment in a Python OpenAI project using the LangWatch Prompts CLI.",
        agents: [
          createClaudeCodeAgent({ workingDirectory: tempFolder }),
          scenario.userSimulatorAgent({ model: judgeModel }),
          scenario.judgeAgent({
            model: judgeModel,
            criteria: [
              "Agent explains or sets up tag-based deployment (production/staging tags)",
              "Agent updates code to fetch prompts by tag instead of bare slug",
              "Agent mentions the Deploy dialog or platform_assign_prompt_tag for assigning tags",
            ],
          }),
        ],
        script: [
          scenario.user(
            "set up tag-based deployment for my prompts so I can use production and staging versions separately"
          ),
          scenario.agent(),
          (state) => {
            toolCallFix(state);
            assertSkillWasRead(state, "prompts");

            const mainPy = fs.readFileSync(
              path.join(tempFolder, "main.py"),
              "utf8"
            );

            // Code should reference tag-based fetching
            const usesTagFetch = /tag\s*=\s*["']production["']|tag\s*=\s*["']staging["']|{\s*tag:/.test(mainPy);

            expect(
              usesTagFetch,
              "Expected code to fetch prompts by tag (e.g., tag='production' or tag='staging')"
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
