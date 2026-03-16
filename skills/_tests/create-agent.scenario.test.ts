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
} from "./helpers/claude-code-adapter";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, "../.env") });

const isCI = !!process.env.CI;

const judgeModel = openai("gpt-4o");

const skillPath = path.resolve(__dirname, "../create-agent/SKILL.md");
const sharedDir = path.resolve(__dirname, "../_shared");
const referencesDir = path.resolve(__dirname, "../create-agent/references");

/**
 * Creates a fresh empty temp directory for a test run.
 */
function createEmptyTempDir(prefix: string): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), `langwatch-create-agent-${prefix}-`));
}

/**
 * Checks that expected files and directories exist in the project.
 */
function assertProjectStructure(
  projectDir: string,
  { sourceDir }: { sourceDir: string }
): void {
  const mustExist = [
    sourceDir,
    "prompts",
    "tests/scenarios",
    "tests/evaluations",
    ".env",
    ".env.example",
    ".mcp.json",
    ".mcp.json.example",
    "AGENTS.md",
  ];

  for (const relativePath of mustExist) {
    const fullPath = path.join(projectDir, relativePath);
    expect(
      fs.existsSync(fullPath),
      `Expected ${relativePath} to exist in project at ${projectDir}`
    ).toBe(true);
  }
}

/**
 * Searches for LangWatch instrumentation in source files within the given
 * directory. Returns true if any source file contains a "langwatch" reference.
 */
function hasLangWatchInstrumentation(
  projectDir: string,
  sourceDir: string
): boolean {
  const srcPath = path.join(projectDir, sourceDir);
  if (!fs.existsSync(srcPath)) return false;

  const files = fs.readdirSync(srcPath, { recursive: true }) as string[];
  for (const file of files) {
    const filePath = path.join(srcPath, String(file));
    if (!fs.statSync(filePath).isFile()) continue;
    const content = fs.readFileSync(filePath, "utf8");
    if (content.toLowerCase().includes("langwatch")) {
      return true;
    }
  }
  return false;
}

const judgeCriteria = [
  "Agent created a complete project structure with source directory, prompts, tests, env, and MCP config",
  "Agent added LangWatch instrumentation to the source code",
  "Agent created scenario test files",
];

describe("Create Agent Skill", () => {
  it.skipIf(isCI)(
    "scaffolds a Python Agno agent project from an empty directory",
    async () => {
      const tempDir = createEmptyTempDir("agno");

      const result = await scenario.run({
        name: "Python Agno agent creation",
        description:
          "Scaffolding a complete Python Agno agent project from an empty directory with LangWatch instrumentation.",
        agents: [
          createClaudeCodeAgent({
            workingDirectory: tempDir,
            skill: { skillPath, sharedDir, referencesDir },
          }),
          scenario.userSimulatorAgent({ model: judgeModel }),
          scenario.judgeAgent({
            model: judgeModel,
            criteria: judgeCriteria,
          }),
        ],
        script: [
          scenario.user(
            "Create a customer support agent that answers billing questions. Use Agno as the framework and OpenAI as the LLM provider."
          ),
          scenario.agent(),
          (state) => {
            toolCallFix(state);
            assertProjectStructure(tempDir, { sourceDir: "app" });
            expect(
              hasLangWatchInstrumentation(tempDir, "app"),
              "Expected LangWatch instrumentation in app/ source files"
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
    "scaffolds a TypeScript Vercel AI SDK agent project from an empty directory",
    async () => {
      const tempDir = createEmptyTempDir("vercel-ai");

      const result = await scenario.run({
        name: "TypeScript Vercel AI SDK agent creation",
        description:
          "Scaffolding a complete TypeScript Vercel AI SDK agent project from an empty directory with LangWatch instrumentation.",
        agents: [
          createClaudeCodeAgent({
            workingDirectory: tempDir,
            skill: { skillPath, sharedDir, referencesDir },
          }),
          scenario.userSimulatorAgent({ model: judgeModel }),
          scenario.judgeAgent({
            model: judgeModel,
            criteria: judgeCriteria,
          }),
        ],
        script: [
          scenario.user(
            "Create a data analysis agent that helps users explore datasets. Use Vercel AI SDK as the framework and Anthropic as the LLM provider."
          ),
          scenario.agent(),
          (state) => {
            toolCallFix(state);
            assertProjectStructure(tempDir, { sourceDir: "src" });
            expect(
              hasLangWatchInstrumentation(tempDir, "src"),
              "Expected LangWatch instrumentation in src/ source files"
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
    "creates a Python LangGraph agent from scratch",
    async () => {
      const tempDir = createEmptyTempDir("langgraph-py");

      const result = await scenario.run({
        name: "Python LangGraph agent creation",
        description:
          "Scaffolding a complete Python LangGraph agent project from an empty directory with LangWatch instrumentation.",
        agents: [
          createClaudeCodeAgent({
            workingDirectory: tempDir,
            skill: { skillPath, sharedDir, referencesDir },
          }),
          scenario.userSimulatorAgent({ model: judgeModel }),
          scenario.judgeAgent({
            model: judgeModel,
            criteria: judgeCriteria,
          }),
        ],
        script: [
          scenario.user(
            "Create a research assistant agent that can search and summarize information. Use LangGraph as the framework with Python and OpenAI as the LLM provider."
          ),
          scenario.agent(),
          (state) => {
            toolCallFix(state);
            assertProjectStructure(tempDir, { sourceDir: "app" });
            expect(
              hasLangWatchInstrumentation(tempDir, "app"),
              "Expected LangWatch instrumentation in app/ source files"
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
    "creates a TypeScript Mastra agent from scratch",
    async () => {
      const tempDir = createEmptyTempDir("mastra");

      const result = await scenario.run({
        name: "TypeScript Mastra agent creation",
        description:
          "Scaffolding a complete TypeScript Mastra agent project from an empty directory with LangWatch instrumentation.",
        agents: [
          createClaudeCodeAgent({
            workingDirectory: tempDir,
            skill: { skillPath, sharedDir, referencesDir },
          }),
          scenario.userSimulatorAgent({ model: judgeModel }),
          scenario.judgeAgent({
            model: judgeModel,
            criteria: judgeCriteria,
          }),
        ],
        script: [
          scenario.user(
            "Create a task management agent that helps users organize their work. Use Mastra as the framework and OpenAI as the LLM provider."
          ),
          scenario.agent(),
          (state) => {
            toolCallFix(state);
            assertProjectStructure(tempDir, { sourceDir: "src" });
            expect(
              hasLangWatchInstrumentation(tempDir, "src"),
              "Expected LangWatch instrumentation in src/ source files"
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
