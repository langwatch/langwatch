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

function copyRecipeSkillToWorkDir(tempFolder: string, recipeName: string) {
  const skillDir = path.join(tempFolder, ".skills", recipeName);
  fs.mkdirSync(skillDir, { recursive: true });
  fs.copyFileSync(
    path.resolve(__dirname, `../recipes/${recipeName}/SKILL.md`),
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
    if (
      entry.isDirectory() &&
      entry.name !== "node_modules" &&
      entry.name !== ".venv"
    ) {
      results.push(...findTestFiles(fullPath, pattern));
    } else if (entry.isFile() && pattern.test(entry.name)) {
      results.push(fullPath);
    }
  }
  return results;
}

function findNewPythonFiles(
  dir: string,
  excludeNames: string[] = ["main.py"]
): string[] {
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

describe("Recipes", () => {
  it.skipIf(isCI)(
    "generates a RAG evaluation dataset from the TerraVerde knowledge base",
    async () => {
      const tempFolder = fs.mkdtempSync(
        path.join(os.tmpdir(), "langwatch-recipe-rag-dataset-")
      );

      execSync(
        `cp -r ${path.resolve(__dirname, "fixtures/python-rag-agent")}/* ${tempFolder}/`
      );
      copyRecipeSkillToWorkDir(tempFolder, "generate-rag-dataset");

      const result = await scenario.run({
        name: "Generate RAG evaluation dataset",
        description:
          "Generate a synthetic evaluation dataset from the TerraVerde farm advisory RAG knowledge base, including diverse question types and context per row.",
        agents: [
          createClaudeCodeAgent({ workingDirectory: tempFolder }),
          scenario.userSimulatorAgent({ model: judgeModel }),
          scenario.judgeAgent({
            model: judgeModel,
            criteria: [
              "Agent read the knowledge base and generated a dataset specific to the agricultural domain",
              "Agent created a CSV or Python file containing the evaluation dataset",
              "Agent included diverse question types (factual, multi-hop, comparison, edge cases, or negative)",
            ],
          }),
        ],
        script: [
          scenario.user(
            "generate an evaluation dataset from my RAG knowledge base"
          ),
          scenario.agent(),
          (state) => {
            toolCallFix(state);

            // Find CSV or Python dataset files
            const csvFiles = findTestFiles(tempFolder, /\.csv$/);
            const pyFiles = findNewPythonFiles(tempFolder);

            expect(
              csvFiles.length + pyFiles.length,
              `Expected at least one CSV or Python file with dataset in ${tempFolder}`
            ).toBeGreaterThan(0);

            // Read all generated content
            const allContent = [
              ...csvFiles.map((f) => fs.readFileSync(f, "utf8")),
              ...pyFiles.map((f) => fs.readFileSync(f, "utf8")),
            ]
              .join("\n")
              .toLowerCase();

            // Verify agricultural domain terms
            const hasDomainTerms =
              allContent.includes("irrigation") ||
              allContent.includes("frost") ||
              allContent.includes("pest") ||
              allContent.includes("soil") ||
              allContent.includes("crop") ||
              allContent.includes("apple") ||
              allContent.includes("harvest");
            expect(
              hasDomainTerms,
              "Expected dataset to contain agricultural domain terms"
            ).toBe(true);

            // Verify diverse question types
            const hasQuestionTypes =
              allContent.includes("factual") ||
              allContent.includes("multi") ||
              allContent.includes("comparison") ||
              allContent.includes("edge") ||
              allContent.includes("negative") ||
              allContent.includes("question_type");
            expect(
              hasQuestionTypes,
              "Expected dataset to include diverse question types"
            ).toBe(true);

            // Verify context column is present
            const hasContext =
              allContent.includes("context");
            expect(
              hasContext,
              "Expected dataset to include context column or field"
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
    "creates compliance scenario tests for the health agent",
    async () => {
      const tempFolder = fs.mkdtempSync(
        path.join(os.tmpdir(), "langwatch-recipe-compliance-")
      );

      execSync(
        `cp -r ${path.resolve(__dirname, "fixtures/python-health-agent")}/* ${tempFolder}/`
      );
      copyRecipeSkillToWorkDir(tempFolder, "test-compliance");

      const result = await scenario.run({
        name: "Health agent compliance tests",
        description:
          "Create scenario tests that verify the health wellness agent stays observational and does not give prescriptive medical advice. Include boundary enforcement and red team tests.",
        agents: [
          createClaudeCodeAgent({ workingDirectory: tempFolder }),
          scenario.userSimulatorAgent({ model: judgeModel }),
          scenario.judgeAgent({
            model: judgeModel,
            criteria: [
              "Agent created scenario test files with compliance boundary enforcement",
              "Agent included criteria about NOT diagnosing or prescribing",
              "Agent included red team or adversarial testing for compliance probing",
            ],
          }),
        ],
        script: [
          scenario.user(
            "test that my health agent doesn't give prescriptive medical advice. Create scenario tests with boundary enforcement and red teaming."
          ),
          scenario.agent(),
          (state) => {
            toolCallFix(state);

            // Find test files (Python or TypeScript)
            const pyTestFiles = findTestFiles(tempFolder, /^test_.*\.py$/);
            const tsTestFiles = findTestFiles(tempFolder, /\.(test|spec)\.ts$/);

            expect(
              pyTestFiles.length + tsTestFiles.length,
              `Expected at least one test file in ${tempFolder}`
            ).toBeGreaterThan(0);

            const testContent = [
              ...pyTestFiles.map((f) => fs.readFileSync(f, "utf8")),
              ...tsTestFiles.map((f) => fs.readFileSync(f, "utf8")),
            ]
              .join("\n")
              .toLowerCase();

            // Verify scenario framework usage
            expect(
              testContent.includes("scenario"),
              "Expected test files to use the scenario framework"
            ).toBe(true);

            // Verify compliance-related criteria
            const hasComplianceCriteria =
              testContent.includes("disclaim") ||
              testContent.includes("not diagnos") ||
              testContent.includes("not prescrib") ||
              testContent.includes("not recommend") ||
              testContent.includes("must not") ||
              testContent.includes("does not");
            expect(
              hasComplianceCriteria,
              "Expected test files to contain compliance criteria (disclaim, NOT diagnose, NOT prescribe)"
            ).toBe(true);

            // Verify red team or adversarial testing
            const hasRedTeam =
              testContent.includes("redteam") ||
              testContent.includes("red_team") ||
              testContent.includes("red team") ||
              testContent.includes("adversarial");
            expect(
              hasRedTeam,
              "Expected test files to include RedTeamAgent or adversarial testing"
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
    "uses MCP to debug instrumentation traces",
    async () => {
      const tempFolder = fs.mkdtempSync(
        path.join(os.tmpdir(), "langwatch-recipe-debug-instrumentation-")
      );

      execSync(
        `cp -r ${path.resolve(__dirname, "fixtures/python-openai")}/* ${tempFolder}/`
      );
      copyRecipeSkillToWorkDir(tempFolder, "debug-instrumentation");

      const result = await scenario.run({
        name: "Debug instrumentation via MCP",
        description:
          "Use the LangWatch MCP to inspect production traces and identify instrumentation issues or suggest improvements.",
        agents: [
          createClaudeCodeAgent({ workingDirectory: tempFolder }),
          scenario.userSimulatorAgent({ model: judgeModel }),
          scenario.judgeAgent({
            model: judgeModel,
            criteria: [
              "Agent used LangWatch MCP tools (search_traces or get_trace) to inspect traces",
              "Agent provided suggestions or identified issues with the current instrumentation",
            ],
          }),
        ],
        script: [
          scenario.user(
            "check my langwatch traces and see if there's anything to improve"
          ),
          scenario.agent(),
          (state) => {
            toolCallFix(state);

            // Verify the agent used MCP trace tools
            const allContent = state.messages
              .map((m) =>
                typeof m.content === "string"
                  ? m.content
                  : JSON.stringify(m.content)
              )
              .join("\n");

            expect(
              allContent.includes("search_traces") ||
                allContent.includes("get_trace"),
              "Expected agent to use MCP tools (search_traces or get_trace) to inspect traces"
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
