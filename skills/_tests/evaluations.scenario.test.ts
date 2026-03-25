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
  const skillDir = path.join(tempFolder, runner.capabilities.skillsDirectory, "evaluations");
  fs.mkdirSync(skillDir, { recursive: true });
  fs.copyFileSync(
    path.resolve(__dirname, "../evaluations/SKILL.md"),
    path.join(skillDir, "SKILL.md")
  );
  const sharedDir = path.join(skillDir, "_shared");
  fs.mkdirSync(sharedDir, { recursive: true });
  execSync(
    `cp -r ${path.resolve(__dirname, "../_shared")}/* ${sharedDir}/`
  );
}

function findNewPythonFiles(dir: string, excludeNames: string[] = ["main.py"]): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (
      entry.isDirectory() &&
      !entry.name.startsWith(".") &&
      entry.name !== "node_modules" &&
      entry.name !== ".venv"
    ) {
      results.push(...findNewPythonFiles(fullPath, []));
    } else if (
      entry.isFile() &&
      !excludeNames.includes(entry.name) &&
      (/\.ipynb$/.test(entry.name) || /\.py$/.test(entry.name))
    ) {
      results.push(fullPath);
    }
  }
  return results;
}

describe("Evaluations Skill", () => {
  it.skipIf(isCI)(
    "creates an evaluation experiment for a Python OpenAI bot",
    async () => {
      const tempFolder = fs.mkdtempSync(
        path.join(os.tmpdir(), "langwatch-skill-evaluation-py-")
      );

      execSync(
        `cp -r ${path.resolve(__dirname, "fixtures/python-openai")}/* ${tempFolder}/`
      );
      copySkillToWorkDir(tempFolder);

      const result = await scenario.run({
        name: "Python OpenAI evaluation experiment",
        description:
          "Creating an evaluation experiment for a Python OpenAI chatbot that replies with tweet-like responses and emojis.",
        agents: [
          createAgent({ workingDirectory: tempFolder }),
          scenario.userSimulatorAgent({ model: judgeModel }),
          scenario.judgeAgent({
            model: judgeModel,
            criteria: [
              "Agent created an evaluation experiment file (notebook or script)",
              "Agent generated a dataset that is specific to the agent's domain — for this tweet-like emoji bot, the dataset should contain inputs that real users would send to this bot, NOT generic trivia like 'What is 2+2?' or 'Capital of France'",
            ],
          }),
        ],
        script: [
          scenario.user(
            "create a batch evaluation experiment for my agent using langwatch.experiment SDK (not scenario tests). Read my agent code first to understand what it does and generate a dataset that matches its actual purpose."
          ),
          scenario.agent(),
          (state) => {
            toolCallFix(state);
            assertSkillWasRead(state, "evaluations");

            const newFiles = findNewPythonFiles(tempFolder);
            expect(
              newFiles.length,
              `Expected at least one new .py or .ipynb file created in ${tempFolder}`
            ).toBeGreaterThan(0);

            const fileContents = newFiles
              .map((f) => fs.readFileSync(f, "utf8"))
              .join("\n")
              .toLowerCase();

            expect(fileContents).toContain("langwatch");

            // Verify the dataset is NOT generic — should NOT have trivia-style examples
            expect(
              fileContents,
              "Dataset should not contain generic trivia like 'capital of france' — it should be specific to the tweet-like emoji bot"
            ).not.toMatch(/capital of france|what is 2 ?\+ ?2|quantum computing|photosynthesis/);
          },
          scenario.judge(),
        ],
      });

      expect(result.success).toBe(true);
    },
    600_000
  );

  it.skipIf(isCI)(
    "creates an evaluation experiment for a TypeScript Vercel AI bot",
    async () => {
      const tempFolder = fs.mkdtempSync(
        path.join(os.tmpdir(), "langwatch-skill-evaluations-ts-")
      );

      execSync(
        `cp -r ${path.resolve(__dirname, "fixtures/typescript-vercel")}/* ${tempFolder}/`
      );
      copySkillToWorkDir(tempFolder);

      const result = await scenario.run({
        name: "TypeScript Vercel AI evaluation experiment",
        description:
          "Creating an evaluation experiment for a TypeScript Vercel AI chatbot.",
        agents: [
          createAgent({ workingDirectory: tempFolder }),
          scenario.userSimulatorAgent({ model: judgeModel }),
          scenario.judgeAgent({
            model: judgeModel,
            criteria: [
              "Agent created an evaluation experiment file (script or test)",
              "Agent generated a dataset relevant to the agent's functionality",
            ],
          }),
        ],
        script: [
          scenario.user(
            "create a batch evaluation experiment for my agent using langwatch experiments SDK"
          ),
          scenario.agent(),
          (state) => {
            toolCallFix(state);
            assertSkillWasRead(state, "evaluations");
            // Find new TypeScript files (not index.ts)
            const files = fs
              .readdirSync(tempFolder)
              .filter((f) => f.endsWith(".ts") && f !== "index.ts");
            expect(
              files.length,
              "Expected at least one new .ts file"
            ).toBeGreaterThan(0);
            const content = files
              .map((f) =>
                fs.readFileSync(path.join(tempFolder, f), "utf8")
              )
              .join("\n");
            expect(content).toContain("langwatch");
          },
          scenario.judge(),
        ],
      });

      expect(result.success).toBe(true);
    },
    600_000
  );

  it.skipIf(isCI)(
    "creates an evaluation experiment for a Python LangGraph agent",
    async () => {
      const tempFolder = fs.mkdtempSync(
        path.join(os.tmpdir(), "langwatch-skill-evaluations-langgraph-")
      );
      execSync(
        `cp -r ${path.resolve(__dirname, "fixtures/python-langgraph")}/* ${tempFolder}/`
      );
      copySkillToWorkDir(tempFolder);

      const result = await scenario.run({
        name: "Python LangGraph evaluation experiment",
        description:
          "Creating an evaluation experiment for a Python LangGraph agent.",
        agents: [
          createAgent({ workingDirectory: tempFolder }),
          scenario.userSimulatorAgent({ model: judgeModel }),
          scenario.judgeAgent({
            model: judgeModel,
            criteria: [
              "Agent created an evaluation experiment file",
              "Agent generated a dataset relevant to the LangGraph agent functionality",
            ],
          }),
        ],
        script: [
          scenario.user(
            "create a batch evaluation experiment for my agent using langwatch.experiment SDK"
          ),
          scenario.agent(),
          (state) => {
            toolCallFix(state);
            assertSkillWasRead(state, "evaluations");
            const newFiles = findNewPythonFiles(tempFolder);
            expect(
              newFiles.length,
              "Expected at least one new .py file"
            ).toBeGreaterThan(0);
            const content = newFiles
              .map((f) => fs.readFileSync(f, "utf8"))
              .join("\n");
            expect(content).toContain("langwatch");
          },
          scenario.judge(),
        ],
      });
      expect(result.success).toBe(true);
    },
    600_000
  );

  it.skipIf(isCI)(
    "creates a targeted evaluation for RAG faithfulness",
    async () => {
      const tempFolder = fs.mkdtempSync(
        path.join(os.tmpdir(), "langwatch-skill-evaluations-targeted-")
      );
      execSync(
        `cp -r ${path.resolve(__dirname, "fixtures/python-openai")}/* ${tempFolder}/`
      );
      copySkillToWorkDir(tempFolder);

      const result = await scenario.run({
        name: "Targeted RAG faithfulness evaluation",
        description:
          "Adding a specific evaluation for checking if the agent's responses are faithful to the context provided.",
        agents: [
          createAgent({ workingDirectory: tempFolder }),
          scenario.userSimulatorAgent({ model: judgeModel }),
          scenario.judgeAgent({
            model: judgeModel,
            criteria: [
              "Agent created an evaluation focused specifically on faithfulness or hallucination detection",
              "The evaluation is targeted, not a generic test suite",
            ],
          }),
        ],
        script: [
          scenario.user(
            "create an evaluation that checks if my agent hallucinates, use langwatch experiments SDK with a faithfulness evaluator"
          ),
          scenario.agent(),
          (state) => {
            toolCallFix(state);
            assertSkillWasRead(state, "evaluations");
            const newFiles = findNewPythonFiles(tempFolder);
            expect(newFiles.length).toBeGreaterThan(0);
            const content = newFiles
              .map((f) => fs.readFileSync(f, "utf8"))
              .join("\n");
            expect(content).toContain("langwatch");
          },
          scenario.judge(),
        ],
      });
      expect(result.success).toBe(true);
    },
    600_000
  );

  it.skipIf(isCI)(
    "creates domain-specific evaluation for a RAG agent",
    async () => {
      const tempFolder = fs.mkdtempSync(
        path.join(os.tmpdir(), "langwatch-skill-evaluations-rag-")
      );
      execSync(
        `cp -r ${path.resolve(__dirname, "fixtures/python-rag-agent")}/* ${tempFolder}/`
      );
      copySkillToWorkDir(tempFolder);

      const result = await scenario.run({
        name: "RAG agent domain-specific evaluation",
        description:
          "Creating an evaluation experiment for a TerraVerde farm advisory RAG agent.",
        agents: [
          createAgent({ workingDirectory: tempFolder }),
          scenario.userSimulatorAgent({ model: judgeModel }),
          scenario.judgeAgent({
            model: judgeModel,
            criteria: [
              "Agent created an evaluation experiment with domain-specific data about agriculture, irrigation, frost protection, or pest management",
              "Dataset does NOT contain generic trivia — it has realistic agronomic questions",
            ],
          }),
        ],
        script: [
          scenario.user(
            "create a batch evaluation experiment for my farm advisory RAG agent. Read the codebase to understand the knowledge base and domain. Generate a dataset with realistic agronomic questions. Use langwatch.experiment SDK."
          ),
          scenario.agent(),
          (state) => {
            toolCallFix(state);
            assertSkillWasRead(state, "evaluations");
            const newFiles = findNewPythonFiles(tempFolder);
            expect(newFiles.length).toBeGreaterThan(0);
            const content = newFiles
              .map((f) => fs.readFileSync(f, "utf8"))
              .join("\n")
              .toLowerCase();
            expect(content).toContain("langwatch");

            // Verify domain specificity
            const hasDomainTerms =
              content.includes("irrigation") ||
              content.includes("frost") ||
              content.includes("pest") ||
              content.includes("soil") ||
              content.includes("crop");
            expect(
              hasDomainTerms,
              "Expected dataset to contain agricultural domain terms"
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
    "creates evaluation for a Google ADK agent using Gemini models — not OpenAI",
    async () => {
      const tempFolder = fs.mkdtempSync(
        path.join(os.tmpdir(), "langwatch-skill-evaluations-google-adk-")
      );
      execSync(
        `cp -r ${path.resolve(__dirname, "fixtures/python-google-adk")}/* ${tempFolder}/`
      );
      copySkillToWorkDir(tempFolder);

      const result = await scenario.run({
        name: "Google ADK evaluation — model provider detection",
        description:
          "Creating an evaluation experiment for a Google ADK agent. The agent uses Gemini models, so the generated evaluation code should use Gemini-compatible model references, NOT hardcode OpenAI models.",
        agents: [
          createAgent({ workingDirectory: tempFolder }),
          scenario.userSimulatorAgent({ model: judgeModel }),
          scenario.judgeAgent({
            model: judgeModel,
            criteria: [
              "Agent created an evaluation experiment file (notebook or script)",
              "Agent detected that this is a Google ADK project using Gemini models and adapted accordingly — evaluator model settings should reference a Gemini-compatible model (e.g., gemini/gemini-2.0-flash or vertex_ai/gemini-2.0-flash), NOT openai/gpt-5-mini",
              "Agent generated a dataset specific to the weather assistant domain",
            ],
          }),
        ],
        script: [
          scenario.user(
            "create a batch evaluation experiment for my agent using langwatch.experiment SDK, short and sweet, no need to run it. IMPORTANT: read my agent code first to understand what framework and model provider it uses."
          ),
          scenario.agent(),
          (state) => {
            toolCallFix(state);

            const newFiles = findNewPythonFiles(tempFolder);
            expect(
              newFiles.length,
              `Expected at least one new .py or .ipynb file created in ${tempFolder}`
            ).toBeGreaterThan(0);

            const fileContents = newFiles
              .map((f) => fs.readFileSync(f, "utf8"))
              .join("\n");

            expect(fileContents).toContain("langwatch");

            // The generated code should NOT hardcode OpenAI models for a Google ADK project
            const lowerContents = fileContents.toLowerCase();
            expect(
              lowerContents,
              "Evaluation for a Google ADK agent should NOT hardcode openai/gpt-5-mini — it should use a Gemini-compatible model"
            ).not.toMatch(/["']openai\/gpt/);

            // Should reference Gemini or Google model provider
            const usesGeminiModel =
              lowerContents.includes("gemini") ||
              lowerContents.includes("vertex_ai") ||
              lowerContents.includes("google");
            expect(
              usesGeminiModel,
              "Expected evaluation to reference Gemini/Google model provider, not OpenAI"
            ).toBe(true);
          },
          scenario.judge(),
        ],
      });

      expect(result.success).toBe(true);
    },
    600_000
  );

  it.skipIf(isCI || !runner.capabilities.supportsMcp)(
    "evaluations actually work — evaluators created on platform",
    async () => {
      const tempFolder = fs.mkdtempSync(
        path.join(os.tmpdir(), "langwatch-skill-evaluations-e2e-")
      );

      execSync(
        `cp -r ${path.resolve(__dirname, "fixtures/typescript-weather-agent")}/* ${tempFolder}/`
      );
      copySkillToWorkDir(tempFolder);

      fs.writeFileSync(
        path.join(tempFolder, ".env"),
        `LANGWATCH_API_KEY=${process.env.LANGWATCH_API_KEY}\nOPENAI_API_KEY=${process.env.OPENAI_API_KEY}\n`
      );

      const result = await scenario.run({
        name: "Evaluations work end-to-end — evaluators exist on platform",
        description:
          "User sets up evaluations for a weather agent. The agent must create evaluators on the LangWatch platform so the experiment actually produces results.",
        agents: [
          createAgent({ workingDirectory: tempFolder }),
          scenario.userSimulatorAgent({ model: judgeModel }),
          scenario.judgeAgent({
            model: judgeModel,
            criteria: [
              "Agent created and ran an evaluation experiment for the weather agent",
              "Agent set up evaluators on the LangWatch platform before or during the experiment",
            ],
          }),
        ],
        script: [
          scenario.user(
            "Set up evaluations for my agent"
          ),
          scenario.agent(),
          async (state) => {
            toolCallFix(state);

            // Verify evaluators actually exist on the platform
            const apiKey = process.env.LANGWATCH_API_KEY!;
            const res = await fetch(
              "https://app.langwatch.ai/api/evaluators",
              {
                headers: { "X-Auth-Token": apiKey },
              }
            );
            const evaluators = await res.json();

            expect(
              Array.isArray(evaluators) && evaluators.length > 0,
              `Expected evaluators to exist on the platform after setup, but found none. The experiment will fail with 'Evaluator not found' errors.`
            ).toBe(true);
          },
          scenario.judge(),
        ],
      });

      expect(result.success).toBe(true);
    },
    900_000
  );
});
