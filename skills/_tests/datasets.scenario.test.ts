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
  setupLocalCli,
} from "./helpers/claude-code-adapter";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, "../.env") });

const isCI = !!process.env.CI;

const judgeModel = openai("gpt-5-mini");

function copySkillToWorkDir(tempFolder: string) {
  const skillDir = path.join(tempFolder, ".skills", "datasets");
  fs.mkdirSync(skillDir, { recursive: true });
  fs.copyFileSync(
    path.resolve(__dirname, "../datasets/SKILL.md"),
    path.join(skillDir, "SKILL.md")
  );
  const sharedDir = path.join(skillDir, "_shared");
  fs.mkdirSync(sharedDir, { recursive: true });
  const sharedSource = path.resolve(__dirname, "../_shared");
  if (fs.existsSync(sharedSource)) {
    execSync(`cp -r ${sharedSource}/* ${sharedDir}/`);
  }
}

function findGeneratedFiles(dir: string, extensions: string[]): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (
      entry.isDirectory() &&
      !entry.name.startsWith(".") &&
      entry.name !== "node_modules" &&
      entry.name !== ".venv" &&
      entry.name !== "bin"
    ) {
      results.push(...findGeneratedFiles(fullPath, extensions));
    } else if (
      entry.isFile() &&
      extensions.some((ext) => entry.name.endsWith(ext))
    ) {
      results.push(fullPath);
    }
  }
  return results;
}

describe("Dataset Generation Skill", () => {
  it.skipIf(isCI)(
    "generates a domain-specific dataset for a Python chatbot",
    async () => {
      const tempFolder = fs.mkdtempSync(
        path.join(os.tmpdir(), "langwatch-skill-dataset-py-")
      );

      // Copy the tweet-bot fixture — agent must generate data matching its domain
      execSync(
        `cp -r ${path.resolve(__dirname, "fixtures/python-openai")}/* ${tempFolder}/`
      );
      copySkillToWorkDir(tempFolder);
      setupLocalCli(tempFolder);

      // Write a .env so CLI commands work
      const envContent = [
        `LANGWATCH_API_KEY=${process.env.LANGWATCH_API_KEY}`,
        `LANGWATCH_ENDPOINT=${process.env.LANGWATCH_ENDPOINT ?? "http://localhost:5560"}`,
      ].join("\n");
      fs.writeFileSync(path.join(tempFolder, ".env"), envContent);

      const result = await scenario.run({
        name: "Dataset generation for tweet-bot",
        description:
          "Generate a realistic evaluation dataset for a Python OpenAI chatbot that replies with tweet-like responses and emojis. The skill should explore the codebase first, propose a plan, show a preview, and generate a CSV.",
        agents: [
          createClaudeCodeAgent({ workingDirectory: tempFolder }),
          scenario.userSimulatorAgent({
            model: judgeModel,
            instructions:
              "You are a developer who wants to create an evaluation dataset for your chatbot. " +
              "When the agent proposes a plan, confirm it. When shown a preview, approve it and ask to continue. " +
              "Be brief in your responses — just confirm and let the agent do its work.",
          }),
          scenario.judgeAgent({
            model: judgeModel,
            criteria: [
              "Agent read the codebase to understand the chatbot's purpose (tweet-like responses with emojis)",
              "Agent proposed a dataset generation plan before generating data",
              "Agent created a CSV file with realistic evaluation data",
              "The generated dataset contains inputs that a real user would send to a tweet-like emoji bot — NOT generic trivia like 'What is the capital of France?' or 'Explain quantum computing'",
              "The dataset has at least 10 rows of data",
            ],
          }),
        ],
        script: [
          scenario.user(
            "generate an evaluation dataset for my chatbot. read my code first to understand what it does, then create something realistic."
          ),
          scenario.agent(),
          (state) => { toolCallFix(state); },
          scenario.user(),
          scenario.agent(),
          (state) => { toolCallFix(state); },
          scenario.user(),
          scenario.agent(),
          (state) => {
            toolCallFix(state);
            assertSkillWasRead(state, "datasets");

            // Check a CSV file was created
            const csvFiles = findGeneratedFiles(tempFolder, [".csv"]);
            expect(
              csvFiles.length,
              `Expected at least one CSV file in ${tempFolder}`
            ).toBeGreaterThan(0);

            // Read the CSV and validate it has realistic content
            const csvContent = csvFiles
              .map((f) => fs.readFileSync(f, "utf8"))
              .join("\n")
              .toLowerCase();

            // Should have meaningful rows (at least a header + 10 data rows)
            const lineCount = csvContent.split("\n").filter((l) => l.trim()).length;
            expect(
              lineCount,
              "Dataset should have at least 11 lines (header + 10 rows)"
            ).toBeGreaterThanOrEqual(11);

            // Should NOT be dominated by generic trivia — a tweet-bot dataset should have
            // casual, fun, social-media-style inputs, not textbook questions
            expect(
              csvContent,
              "Dataset should not contain academic trivia like 'capital of france' or 'quantum computing'"
            ).not.toMatch(
              /capital of france|quantum computing|photosynthesis|explain the theory of/
            );
          },
          scenario.judge(),
        ],
      });

      expect(result.success).toBe(true);
    },
    900_000
  );

  it.skipIf(isCI)(
    "generates a RAG-specific dataset with context columns for a farm advisory agent",
    async () => {
      const tempFolder = fs.mkdtempSync(
        path.join(os.tmpdir(), "langwatch-skill-dataset-rag-")
      );

      // Copy the RAG fixture — agent should find the knowledge base
      execSync(
        `cp -r ${path.resolve(__dirname, "fixtures/python-rag-agent")}/* ${tempFolder}/`
      );
      copySkillToWorkDir(tempFolder);
      setupLocalCli(tempFolder);

      const envContent = [
        `LANGWATCH_API_KEY=${process.env.LANGWATCH_API_KEY}`,
        `LANGWATCH_ENDPOINT=${process.env.LANGWATCH_ENDPOINT ?? "http://localhost:5560"}`,
      ].join("\n");
      fs.writeFileSync(path.join(tempFolder, ".env"), envContent);

      const result = await scenario.run({
        name: "RAG dataset generation for farm advisory",
        description:
          "Generate a RAG evaluation dataset for a farm advisory bot with a knowledge base about irrigation, frost protection, and pest management.",
        agents: [
          createClaudeCodeAgent({ workingDirectory: tempFolder }),
          scenario.userSimulatorAgent({
            model: judgeModel,
            instructions:
              "You are a farm tech developer who wants to test your RAG agent. " +
              "When asked questions, provide brief answers. When shown a plan, approve it. " +
              "When shown a preview, say it looks good and ask to finish generating. " +
              "Mention that you want to test hallucination detection too.",
          }),
          scenario.judgeAgent({
            model: judgeModel,
            criteria: [
              "Agent read the codebase and discovered the knowledge base about farming (irrigation, frost, pest management)",
              "Agent proposed a plan that includes farming-specific categories",
              "Agent created a CSV with domain-specific farming questions — NOT generic questions",
              "The dataset includes questions about irrigation thresholds, frost protection, or pest management — matching the actual knowledge base",
              "The dataset includes at least some negative/edge cases (questions the KB cannot answer)",
            ],
          }),
        ],
        script: [
          scenario.user(
            "I need an evaluation dataset for my RAG agent. Can you look at my code and generate something realistic? I want to test both accuracy and hallucination."
          ),
          scenario.agent(),
          (state) => { toolCallFix(state); },
          scenario.user(),
          scenario.agent(),
          (state) => { toolCallFix(state); },
          scenario.user(),
          scenario.agent(),
          (state) => {
            toolCallFix(state);
            assertSkillWasRead(state, "datasets");

            const csvFiles = findGeneratedFiles(tempFolder, [".csv"]);
            expect(csvFiles.length).toBeGreaterThan(0);

            const csvContent = csvFiles
              .map((f) => fs.readFileSync(f, "utf8"))
              .join("\n")
              .toLowerCase();

            // Should contain farming domain terms
            const hasFarmTerms =
              csvContent.includes("irrigat") ||
              csvContent.includes("frost") ||
              csvContent.includes("pest") ||
              csvContent.includes("orchard") ||
              csvContent.includes("soil");

            expect(
              hasFarmTerms,
              "Dataset should contain farming-related terms (irrigation, frost, pest, orchard, soil)"
            ).toBe(true);

            // Should NOT be generic
            expect(csvContent).not.toMatch(
              /capital of france|what is 2 ?\+ ?2|quantum computing/
            );
          },
          scenario.judge(),
        ],
      });

      expect(result.success).toBe(true);
    },
    900_000
  );

  it.skipIf(isCI)(
    "presents a plan and waits for user confirmation in multi-turn flow",
    async () => {
      const tempFolder = fs.mkdtempSync(
        path.join(os.tmpdir(), "langwatch-skill-dataset-multiturn-")
      );

      execSync(
        `cp -r ${path.resolve(__dirname, "fixtures/python-openai")}/* ${tempFolder}/`
      );
      copySkillToWorkDir(tempFolder);
      setupLocalCli(tempFolder);

      const envContent = [
        `LANGWATCH_API_KEY=${process.env.LANGWATCH_API_KEY}`,
        `LANGWATCH_ENDPOINT=${process.env.LANGWATCH_ENDPOINT ?? "http://localhost:5560"}`,
      ].join("\n");
      fs.writeFileSync(path.join(tempFolder, ".env"), envContent);

      const result = await scenario.run({
        name: "Multi-turn dataset generation flow",
        description:
          "Test that the agent follows the plan-preview-generate flow and asks for confirmation at each step.",
        agents: [
          createClaudeCodeAgent({ workingDirectory: tempFolder }),
          scenario.userSimulatorAgent({
            model: judgeModel,
            instructions:
              "You want a dataset. When the agent proposes a plan, say 'looks good, go ahead'. " +
              "When shown a preview, say 'these look realistic, please generate the full dataset'. " +
              "Be a normal developer, brief and to the point.",
          }),
          scenario.judgeAgent({
            model: judgeModel,
            criteria: [
              "Agent explored the codebase BEFORE proposing a plan or generating data",
              "Agent presented a structured plan or outline to the user before generating the full dataset",
              "Agent generated dataset content (CSV rows or similar) in a later turn, not in the first response",
            ],
          }),
        ],
        script: [
          scenario.user(
            "create an evaluation dataset for my project"
          ),
          scenario.agent(),
          (state) => { toolCallFix(state); },
          scenario.user(),
          scenario.agent(),
          (state) => { toolCallFix(state); },
          scenario.user(),
          scenario.agent(),
          (state) => {
            toolCallFix(state);
            assertSkillWasRead(state, "datasets");
          },
          scenario.judge(),
        ],
      });

      expect(result.success).toBe(true);
    },
    900_000
  );

  it.skipIf(isCI)(
    "generates a hallucination-testing dataset with context column for a RAG agent",
    async () => {
      const tempFolder = fs.mkdtempSync(
        path.join(os.tmpdir(), "langwatch-skill-dataset-hallucination-")
      );

      execSync(
        `cp -r ${path.resolve(__dirname, "fixtures/python-rag-agent")}/* ${tempFolder}/`
      );
      copySkillToWorkDir(tempFolder);
      setupLocalCli(tempFolder);

      const envContent = [
        `LANGWATCH_API_KEY=${process.env.LANGWATCH_API_KEY}`,
        `LANGWATCH_ENDPOINT=${process.env.LANGWATCH_ENDPOINT ?? "http://localhost:5560"}`,
      ].join("\n");
      fs.writeFileSync(path.join(tempFolder, ".env"), envContent);

      const result = await scenario.run({
        name: "Hallucination-focused dataset for RAG agent",
        description:
          "User specifically asks for a dataset to test hallucination in their RAG agent. " +
          "The agent should include a context column and cases where the answer is NOT in the context.",
        agents: [
          createClaudeCodeAgent({ workingDirectory: tempFolder }),
          scenario.userSimulatorAgent({
            model: judgeModel,
            instructions:
              "You want to test hallucination in your RAG farm advisory bot. " +
              "When shown a plan, approve it. When shown a preview, approve it. " +
              "Emphasize that you specifically need to test cases where the bot hallucinates " +
              "answers not in the knowledge base.",
          }),
          scenario.judgeAgent({
            model: judgeModel,
            criteria: [
              "Agent understood the user wants to test hallucination specifically",
              "Agent created a dataset that includes a context or expected_contexts column alongside input and expected_output",
              "Agent included negative cases — questions whose answers are NOT in the provided context, to test hallucination detection",
            ],
          }),
        ],
        script: [
          scenario.user(
            "I need a dataset specifically for testing hallucination in my RAG agent. " +
            "I want to make sure it doesn't make up answers that aren't in the knowledge base. " +
            "Read my code to understand the domain."
          ),
          scenario.agent(),
          (state) => { toolCallFix(state); },
          scenario.user(),
          scenario.agent(),
          (state) => { toolCallFix(state); },
          scenario.user(),
          scenario.agent(),
          (state) => {
            toolCallFix(state);
            assertSkillWasRead(state, "datasets");

            const csvFiles = findGeneratedFiles(tempFolder, [".csv"]);
            expect(csvFiles.length).toBeGreaterThan(0);

            // Read CSV content and check for context-related columns
            const csvContent = csvFiles
              .map((f) => fs.readFileSync(f, "utf8"))
              .join("\n")
              .toLowerCase();

            const headerLine = csvContent.split("\n")[0] ?? "";
            const hasContextColumn =
              headerLine.includes("context") ||
              headerLine.includes("expected_context");

            expect(
              hasContextColumn,
              "Dataset should include a context or expected_contexts column for hallucination testing"
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
