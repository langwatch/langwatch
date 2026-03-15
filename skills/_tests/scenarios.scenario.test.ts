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
  const skillDir = path.join(tempFolder, ".skills", "scenarios");
  fs.mkdirSync(skillDir, { recursive: true });
  fs.copyFileSync(
    path.resolve(__dirname, "../scenarios/SKILL.md"),
    path.join(skillDir, "SKILL.md")
  );
  const sharedDir = path.join(skillDir, "_shared");
  fs.mkdirSync(sharedDir, { recursive: true });
  execSync(
    `cp -r ${path.resolve(__dirname, "../_shared")}/* ${sharedDir}/`
  );
}

function findTestFiles(dir: string, pattern: RegExp): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory() && entry.name !== "node_modules" && entry.name !== ".venv") {
      results.push(...findTestFiles(fullPath, pattern));
    } else if (entry.isFile() && pattern.test(entry.name)) {
      results.push(fullPath);
    }
  }
  return results;
}

describe("Scenarios Skill", () => {
  it.skipIf(isCI)(
    "creates scenario tests for a Python OpenAI bot",
    async () => {
      const tempFolder = fs.mkdtempSync(
        path.join(os.tmpdir(), "langwatch-skill-scenario-test-py-")
      );

      execSync(
        `cp -r ${path.resolve(__dirname, "fixtures/python-openai")}/* ${tempFolder}/`
      );
      copySkillToWorkDir(tempFolder);

      const result = await scenario.run({
        name: "Python OpenAI scenario tests",
        description:
          "Adding agent simulation tests to a Python OpenAI bot project using the LangWatch Scenario framework.",
        agents: [
          createClaudeCodeAgent({ workingDirectory: tempFolder }),
          scenario.userSimulatorAgent({ model: judgeModel }),
          scenario.judgeAgent({
            model: judgeModel,
            criteria: [
              "Agent created scenario test files using the LangWatch Scenario framework",
              "Agent should use the LangWatch MCP to check Scenario documentation",
            ],
          }),
        ],
        script: [
          scenario.user(
            "add agent simulation tests for my agent, short and sweet, no need to run the tests"
          ),
          scenario.agent(),
          (state) => {
            toolCallFix(state);

            const testFiles = findTestFiles(tempFolder, /^test_.*\.py$/);
            expect(
              testFiles.length,
              `Expected at least one test_*.py file in ${tempFolder}`
            ).toBeGreaterThan(0);

            const testContent = testFiles
              .map((f) => fs.readFileSync(f, "utf8"))
              .join("\n");

            expect(testContent).toContain("import scenario");
            expect(testContent).toMatch(/scenario\.run\(/);

            expect(testContent).not.toMatch(
              /from\s+(agent_tester|simulation_framework|langwatch\.testing|test_framework)/
            );
          },
          scenario.judge(),
        ],
      });

      expect(result.success).toBe(true);
    },
    600_000
  );

  it.skipIf(isCI)(
    "creates scenario tests for a TypeScript Vercel AI bot",
    async () => {
      const tempFolder = fs.mkdtempSync(
        path.join(os.tmpdir(), "langwatch-skill-scenario-test-ts-")
      );

      execSync(
        `cp -r ${path.resolve(__dirname, "fixtures/typescript-vercel")}/* ${tempFolder}/`
      );
      copySkillToWorkDir(tempFolder);

      const result = await scenario.run({
        name: "TypeScript Vercel AI scenario tests",
        description:
          "Adding agent simulation tests to a TypeScript Vercel AI bot project using the LangWatch Scenario framework.",
        agents: [
          createClaudeCodeAgent({ workingDirectory: tempFolder }),
          scenario.userSimulatorAgent({ model: judgeModel }),
          scenario.judgeAgent({
            model: judgeModel,
            criteria: [
              "Agent created scenario test files using the LangWatch Scenario framework",
              "Agent should use the LangWatch MCP to check Scenario documentation",
            ],
          }),
        ],
        script: [
          scenario.user(
            "add agent simulation tests for my agent, short and sweet, no need to run the tests"
          ),
          scenario.agent(),
          (state) => {
            toolCallFix(state);

            const testFiles = findTestFiles(tempFolder, /\.test\.ts$/);
            expect(
              testFiles.length,
              `Expected at least one .test.ts file in ${tempFolder}`
            ).toBeGreaterThan(0);

            const testContent = testFiles
              .map((f) => fs.readFileSync(f, "utf8"))
              .join("\n");

            expect(testContent).toContain("@langwatch/scenario");
            expect(testContent).toMatch(/scenario\.run\(/);
            expect(testContent).toMatch(
              /(?:from\s+["']vitest["']|import\s+.*vitest)/
            );

            expect(testContent).not.toMatch(
              /from\s+["'](agent_tester|simulation_framework|langwatch\.testing|test_framework)["']/
            );
          },
          scenario.judge(),
        ],
      });

      expect(result.success).toBe(true);
    },
    600_000
  );

  it.skipIf(isCI)(
    "creates red team tests for a Python OpenAI bot",
    async () => {
      const tempFolder = fs.mkdtempSync(
        path.join(os.tmpdir(), "langwatch-skill-scenarios-red-team-py-")
      );

      execSync(
        `cp -r ${path.resolve(__dirname, "fixtures/python-openai")}/* ${tempFolder}/`
      );
      copySkillToWorkDir(tempFolder);

      const result = await scenario.run({
        name: "Python OpenAI red team tests",
        description:
          "Adding adversarial red team tests to a Python OpenAI bot project using the LangWatch Scenario framework's RedTeamAgent.",
        agents: [
          createClaudeCodeAgent({ workingDirectory: tempFolder }),
          scenario.userSimulatorAgent({ model: judgeModel }),
          scenario.judgeAgent({
            model: judgeModel,
            criteria: [
              "Agent created red team tests using Scenario's RedTeamAgent",
              "Agent should use the LangWatch MCP to check Scenario documentation",
            ],
          }),
        ],
        script: [
          scenario.user(
            "red team my agent for vulnerabilities, short and sweet, no need to run the tests"
          ),
          scenario.agent(),
          (state) => {
            toolCallFix(state);

            const testFiles = findTestFiles(tempFolder, /^test_.*\.py$/);
            expect(
              testFiles.length,
              `Expected at least one test_*.py file in ${tempFolder}`
            ).toBeGreaterThan(0);

            const testContent = testFiles
              .map((f) => fs.readFileSync(f, "utf8"))
              .join("\n");

            expect(testContent).toContain("import scenario");
            expect(testContent).toMatch(/RedTeamAgent/);
            expect(testContent).toMatch(/scenario\.run\(/);

            expect(testContent).not.toMatch(
              /from\s+(agent_tester|simulation_framework|langwatch\.testing|red_team_framework)/
            );
          },
          scenario.judge(),
        ],
      });

      expect(result.success).toBe(true);
    },
    600_000
  );

  it.skipIf(isCI)(
    "creates red team tests for a TypeScript Vercel AI bot",
    async () => {
      const tempFolder = fs.mkdtempSync(
        path.join(os.tmpdir(), "langwatch-skill-scenarios-red-team-ts-")
      );

      execSync(
        `cp -r ${path.resolve(__dirname, "fixtures/typescript-vercel")}/* ${tempFolder}/`
      );
      copySkillToWorkDir(tempFolder);

      const result = await scenario.run({
        name: "TypeScript Vercel AI red team tests",
        description:
          "Adding adversarial red team tests to a TypeScript Vercel AI bot project using the LangWatch Scenario framework's RedTeamAgent.",
        agents: [
          createClaudeCodeAgent({ workingDirectory: tempFolder }),
          scenario.userSimulatorAgent({ model: judgeModel }),
          scenario.judgeAgent({
            model: judgeModel,
            criteria: [
              "Agent created red team tests using Scenario's RedTeamAgent",
              "Agent should use the LangWatch MCP to check Scenario documentation",
            ],
          }),
        ],
        script: [
          scenario.user(
            "red team my agent for vulnerabilities, short and sweet, no need to run the tests"
          ),
          scenario.agent(),
          (state) => {
            toolCallFix(state);

            const testFiles = findTestFiles(tempFolder, /\.(test|spec)\.ts$/);
            expect(
              testFiles.length,
              `Expected at least one .test.ts or .spec.ts file in ${tempFolder}`
            ).toBeGreaterThan(0);

            const testContent = testFiles
              .map((f) => fs.readFileSync(f, "utf8"))
              .join("\n");

            expect(testContent).toContain("@langwatch/scenario");
            expect(testContent).toMatch(/redTeam(?:Crescendo|Agent)/);
            expect(testContent).toMatch(/scenario\.run\(/);
            expect(testContent).toMatch(
              /(?:from\s+["']vitest["']|import\s+.*vitest)/
            );

            expect(testContent).not.toMatch(
              /from\s+["'](agent_tester|simulation_framework|langwatch\.testing|red_team_framework)["']/
            );
          },
          scenario.judge(),
        ],
      });

      expect(result.success).toBe(true);
    },
    600_000
  );

  it.skipIf(isCI)(
    "creates a targeted scenario for a specific behavior",
    async () => {
      const tempFolder = fs.mkdtempSync(
        path.join(os.tmpdir(), "langwatch-skill-scenarios-targeted-")
      );

      execSync(
        `cp -r ${path.resolve(__dirname, "fixtures/python-openai")}/* ${tempFolder}/`
      );
      copySkillToWorkDir(tempFolder);

      const result = await scenario.run({
        name: "Targeted scenario for emoji handling",
        description:
          "Adding a specific scenario test for the tweet-like bot to verify it uses emojis correctly.",
        agents: [
          createClaudeCodeAgent({ workingDirectory: tempFolder }),
          scenario.userSimulatorAgent({ model: judgeModel }),
          scenario.judgeAgent({
            model: judgeModel,
            criteria: [
              "Agent created a scenario test specifically about emoji usage",
              "The test is focused on a specific behavior, not a general test suite",
            ],
          }),
        ],
        script: [
          scenario.user(
            "write a scenario test that verifies my bot always includes emojis in its responses when asked about technology topics"
          ),
          scenario.agent(),
          (state) => {
            toolCallFix(state);
            const testFiles = findTestFiles(tempFolder, /^test_.*\.py$/);
            expect(testFiles.length).toBeGreaterThan(0);
            const testContent = testFiles
              .map((f) => fs.readFileSync(f, "utf8"))
              .join("\n");
            expect(testContent).toContain("scenario");
          },
          scenario.judge(),
        ],
      });

      expect(result.success).toBe(true);
    },
    600_000
  );

  it.skipIf(isCI)(
    "uses platform MCP tools when no codebase is present",
    async () => {
      const tempFolder = fs.mkdtempSync(
        path.join(os.tmpdir(), "langwatch-skill-scenarios-platform-")
      );

      // No fixture copied — empty directory
      copySkillToWorkDir(tempFolder);

      const result = await scenario.run({
        name: "Platform scenario creation",
        description:
          "Creating scenarios on the LangWatch platform when there is no codebase.",
        agents: [
          createClaudeCodeAgent({ workingDirectory: tempFolder }),
          scenario.userSimulatorAgent({ model: judgeModel }),
          scenario.judgeAgent({
            model: judgeModel,
            criteria: [
              "Agent used platform MCP tools (platform_create_scenario or similar) to create scenarios",
              "Agent did NOT try to write code files",
            ],
          }),
        ],
        script: [
          scenario.user(
            "create a test scenario for a customer support agent that handles refund requests"
          ),
          scenario.agent(),
          (state) => {
            toolCallFix(state);
            // In platform mode, no test files should be created
            // The agent should use MCP tools instead
          },
          scenario.judge(),
        ],
      });

      expect(result.success).toBe(true);
    },
    600_000
  );
});
