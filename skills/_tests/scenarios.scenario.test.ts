import scenario from "@langwatch/scenario";
import fs from "fs";
import { execSync } from "child_process";
import { describe, it, expect } from "vitest";
import dotenv from "dotenv";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { openai } from "@ai-sdk/openai";
import { createAgent, getRunner } from "./helpers/agent-factory";
import { toolCallFix, assertSkillWasRead } from "./helpers/shared";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, "../.env") });

const isCI = !!process.env.CI;

const judgeModel = openai("gpt-5-mini");
const runner = getRunner();

function copySkillToWorkDir(tempFolder: string) {
  const skillDir = path.join(tempFolder, runner.capabilities.skillsDirectory, "scenarios");
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
          "Adding agent simulation tests to a Python OpenAI conversational bot project using the LangWatch Scenario framework.",
        agents: [
          createAgent({ workingDirectory: tempFolder }),
          scenario.userSimulatorAgent({ model: judgeModel }),
          scenario.judgeAgent({
            model: judgeModel,
            criteria: [
              "Agent created scenario test files using the LangWatch Scenario framework",
              "Agent should have included at least one multi-turn scenario testing conversation flow",
              "Agent should have attempted to run the tests after writing them",
            ],
          }),
        ],
        script: [
          scenario.user(
            "add agent simulation tests for my agent. This is a conversational bot, so include multi-turn tests. Run them after writing to verify they work."
          ),
          scenario.agent(),
          (state) => {
            toolCallFix(state);
            assertSkillWasRead(state, "scenarios");

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

            // Verify at least one multi-turn scenario exists
            expect(
              testContent.includes("max_turns") ||
              testContent.includes("scenario.user(") ||
              testContent.includes("script="),
              "Expected at least one multi-turn scenario (max_turns, scripted user/agent turns)"
            ).toBe(true);

            expect(testContent).not.toMatch(
              /from\s+(agent_tester|simulation_framework|langwatch\.testing|test_framework)/
            );

            // Verify the agent attempted to run the tests (look for pytest cache or execution evidence)
            const ranTests = fs.existsSync(path.join(tempFolder, ".pytest_cache")) ||
              state.messages.some(m => {
                const text = typeof m.content === "string" ? m.content : JSON.stringify(m.content);
                return /pytest|uv run pytest|python -m pytest/.test(text);
              });
            expect(
              ranTests,
              "Expected the agent to run the scenario tests after writing them"
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
          createAgent({ workingDirectory: tempFolder }),
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
            "add agent simulation tests for my agent"
          ),
          scenario.agent(),
          (state) => {
            toolCallFix(state);
            assertSkillWasRead(state, "scenarios");

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
    "creates scenario tests for a Python LangGraph agent",
    async () => {
      const tempFolder = fs.mkdtempSync(
        path.join(os.tmpdir(), "langwatch-skill-scenarios-langgraph-")
      );
      execSync(
        `cp -r ${path.resolve(__dirname, "fixtures/python-langgraph")}/* ${tempFolder}/`
      );
      copySkillToWorkDir(tempFolder);

      const result = await scenario.run({
        name: "Python LangGraph scenario tests",
        description:
          "Adding scenario tests to a Python LangGraph agent project.",
        agents: [
          createAgent({ workingDirectory: tempFolder }),
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
            "add agent simulation tests for my agent"
          ),
          scenario.agent(),
          (state) => {
            toolCallFix(state);
            assertSkillWasRead(state, "scenarios");
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
          createAgent({ workingDirectory: tempFolder }),
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
            "red team my agent for vulnerabilities"
          ),
          scenario.agent(),
          (state) => {
            toolCallFix(state);
            assertSkillWasRead(state, "scenarios");

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
          createAgent({ workingDirectory: tempFolder }),
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
            "red team my agent for vulnerabilities"
          ),
          scenario.agent(),
          (state) => {
            toolCallFix(state);
            assertSkillWasRead(state, "scenarios");

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
          createAgent({ workingDirectory: tempFolder }),
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
            assertSkillWasRead(state, "scenarios");
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

  it.skipIf(isCI || !runner.capabilities.supportsMcp)(
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
          createAgent({ workingDirectory: tempFolder }),
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
            assertSkillWasRead(state, "scenarios");
            // In platform mode, no test files should be created
            // The agent should use MCP tools instead

            // Verify the agent actually used MCP platform tools
            const allContent = state.messages
              .map((m) =>
                typeof m.content === "string"
                  ? m.content
                  : JSON.stringify(m.content)
              )
              .join("\n");

            expect(
              allContent.includes("platform_create_scenario") ||
                allContent.includes("platform_list_scenarios") ||
                allContent.includes("discover_schema"),
              "Expected agent to use platform MCP tools (platform_create_scenario, platform_list_scenarios, or discover_schema)"
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
    "creates scenario tests for a TypeScript Mastra agent",
    async () => {
      const tempFolder = fs.mkdtempSync(
        path.join(os.tmpdir(), "langwatch-skill-scenarios-mastra-")
      );
      execSync(
        `cp -r ${path.resolve(__dirname, "fixtures/typescript-mastra")}/* ${tempFolder}/`
      );
      copySkillToWorkDir(tempFolder);

      const result = await scenario.run({
        name: "TypeScript Mastra scenario tests",
        description:
          "Adding scenario tests to a TypeScript Mastra agent project.",
        agents: [
          createAgent({ workingDirectory: tempFolder }),
          scenario.userSimulatorAgent({ model: judgeModel }),
          scenario.judgeAgent({
            model: judgeModel,
            criteria: [
              "Agent created scenario test files using the LangWatch Scenario framework",
            ],
          }),
        ],
        script: [
          scenario.user(
            "add agent simulation tests for my agent"
          ),
          scenario.agent(),
          (state) => {
            toolCallFix(state);
            assertSkillWasRead(state, "scenarios");
            const testFiles = findTestFiles(tempFolder, /\.(test|spec)\.ts$/);
            expect(testFiles.length).toBeGreaterThan(0);
            const content = testFiles
              .map((f) => fs.readFileSync(f, "utf8"))
              .join("\n");
            expect(content).toContain("@langwatch/scenario");
          },
          scenario.judge(),
        ],
      });
      expect(result.success).toBe(true);
    },
    600_000
  );

  it.skipIf(isCI)(
    "creates domain-specific scenarios for a RAG agent",
    async () => {
      const tempFolder = fs.mkdtempSync(
        path.join(os.tmpdir(), "langwatch-skill-scenarios-rag-")
      );
      execSync(
        `cp -r ${path.resolve(__dirname, "fixtures/python-rag-agent")}/* ${tempFolder}/`
      );
      copySkillToWorkDir(tempFolder);

      const result = await scenario.run({
        name: "RAG agent domain-specific scenarios",
        description:
          "Adding scenario tests to a TerraVerde farm advisory RAG agent that handles irrigation, frost protection, and pest management.",
        agents: [
          createAgent({ workingDirectory: tempFolder }),
          scenario.userSimulatorAgent({ model: judgeModel }),
          scenario.judgeAgent({
            model: judgeModel,
            criteria: [
              "Agent created scenario tests that are specific to the agricultural domain (irrigation, frost, pest management, soil moisture)",
              "Scenarios test the agent's actual knowledge base and advisory capabilities, not generic Q&A",
              "Agent included at least one multi-turn scenario",
            ],
          }),
        ],
        script: [
          scenario.user(
            "add agent simulation tests for my farm advisory agent. Read the codebase to understand what it does. Include multi-turn tests. Run the tests after writing them."
          ),
          scenario.agent(),
          (state) => {
            toolCallFix(state);
            assertSkillWasRead(state, "scenarios");
            const testFiles = findTestFiles(tempFolder, /^test_.*\.py$/);
            expect(testFiles.length).toBeGreaterThan(0);
            const content = testFiles
              .map((f) => fs.readFileSync(f, "utf8"))
              .join("\n")
              .toLowerCase();
            expect(content).toContain("scenario");

            // Verify domain specificity — should reference agriculture concepts, NOT generic trivia
            const hasDomainTerms =
              content.includes("irrigation") ||
              content.includes("frost") ||
              content.includes("pest") ||
              content.includes("soil") ||
              content.includes("crop") ||
              content.includes("harvest");
            expect(
              hasDomainTerms,
              "Expected scenarios to reference agricultural domain concepts"
            ).toBe(true);

            expect(content).not.toMatch(
              /capital of france|what is 2 ?\+ ?2|quantum computing/
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
    "suggests domain-specific improvements after delivering initial scenarios",
    async () => {
      const tempFolder = fs.mkdtempSync(
        path.join(os.tmpdir(), "langwatch-skill-scenarios-consultant-")
      );
      execSync(
        `cp -r ${path.resolve(__dirname, "fixtures/python-rag-agent")}/* ${tempFolder}/`
      );
      copySkillToWorkDir(tempFolder);

      const result = await scenario.run({
        name: "Consultant mode — deeper suggestions",
        description:
          "Agent sets up scenarios for a farm advisory agent, then suggests domain-specific improvements.",
        agents: [
          createAgent({ workingDirectory: tempFolder }),
          scenario.userSimulatorAgent({ model: judgeModel }),
          scenario.judgeAgent({
            model: judgeModel,
            criteria: [
              "Agent delivered working scenario tests",
              "Agent suggested specific domain improvements (e.g., testing frost edge cases, sensor failures, drought conditions, or specific crop types)",
              "Agent did NOT just say 'done' — it offered to go deeper with concrete suggestions",
            ],
          }),
        ],
        script: [
          scenario.user(
            "add scenario tests for my farm advisory agent. After you're done and tests pass, suggest how to make them even better — be specific about what domain edge cases I should cover."
          ),
          scenario.agent(),
          (state) => {
            toolCallFix(state);
            assertSkillWasRead(state, "scenarios");

            // Verify test files were created
            const testFiles = findTestFiles(tempFolder, /^test_.*\.py$/);
            expect(testFiles.length).toBeGreaterThan(0);

            // Verify agent's response includes consultant-style suggestions
            const agentMessages = state.messages
              .filter((m) => m.role === "assistant")
              .map((m) =>
                typeof m.content === "string"
                  ? m.content
                  : JSON.stringify(m.content)
              )
              .join("\n")
              .toLowerCase();

            const hasDeepSuggestions =
              agentMessages.includes("suggest") ||
              agentMessages.includes("could also") ||
              agentMessages.includes("would you like") ||
              agentMessages.includes("go deeper") ||
              agentMessages.includes("edge case") ||
              agentMessages.includes("improve");
            expect(
              hasDeepSuggestions,
              "Expected agent to suggest domain-specific improvements"
            ).toBe(true);
          },
          scenario.judge(),
        ],
      });
      expect(result.success).toBe(true);
    },
    900_000 // longer timeout — agent needs to run tests + generate suggestions
  );

  it.skipIf(isCI)(
    "creates scenario tests for a Google ADK agent using Gemini models — not OpenAI",
    async () => {
      const tempFolder = fs.mkdtempSync(
        path.join(os.tmpdir(), "langwatch-skill-scenarios-google-adk-")
      );
      execSync(
        `cp -r ${path.resolve(__dirname, "fixtures/python-google-adk")}/* ${tempFolder}/`
      );
      copySkillToWorkDir(tempFolder);

      const result = await scenario.run({
        name: "Google ADK scenario tests — model provider detection",
        description:
          "Creating scenario tests for a Google ADK agent. The agent uses Gemini models, so the scenario config should use Gemini-compatible model references, NOT hardcode OpenAI models.",
        agents: [
          createAgent({ workingDirectory: tempFolder }),
          scenario.userSimulatorAgent({ model: judgeModel }),
          scenario.judgeAgent({
            model: judgeModel,
            criteria: [
              "Agent created scenario test files using the LangWatch Scenario framework",
              "Agent detected that this is a Google ADK project using Gemini models and configured the scenario default_model to use a Gemini-compatible model, NOT openai/gpt-5-mini",
              "Agent generated scenarios specific to the weather assistant domain",
            ],
          }),
        ],
        script: [
          scenario.user(
            "add agent simulation tests for my agent, short and sweet, no need to run the tests. IMPORTANT: read my agent code first to understand what framework and model provider it uses."
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

            // The scenario config should NOT hardcode OpenAI for a Google ADK project
            const lowerContent = testContent.toLowerCase();
            expect(
              lowerContent,
              "Scenario tests for a Google ADK agent should NOT hardcode openai/gpt-5-mini as default_model"
            ).not.toMatch(/default_model\s*=\s*["']openai\/gpt/);

            // Should reference Gemini or Google model
            const usesGeminiModel =
              lowerContent.includes("gemini") ||
              lowerContent.includes("vertex_ai") ||
              lowerContent.includes("google");
            expect(
              usesGeminiModel,
              "Expected scenario config to reference Gemini/Google model, not OpenAI"
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
