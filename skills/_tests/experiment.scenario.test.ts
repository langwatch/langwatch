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

const judgeModel = openai("gpt-4.1-mini");

function copySkillToWorkDir(tempFolder: string) {
  const skillDir = path.join(tempFolder, ".skills", "experiment");
  fs.mkdirSync(skillDir, { recursive: true });
  fs.copyFileSync(
    path.resolve(__dirname, "../experiment/SKILL.md"),
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

describe("Experiment Skill", () => {
  it.skipIf(isCI)(
    "creates an evaluation experiment for a Python OpenAI bot",
    async () => {
      const tempFolder = fs.mkdtempSync(
        path.join(os.tmpdir(), "langwatch-skill-experiment-py-")
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
          createClaudeCodeAgent({ workingDirectory: tempFolder }),
          scenario.userSimulatorAgent({ model: judgeModel }),
          scenario.judgeAgent({
            model: judgeModel,
            criteria: [
              "Agent created an evaluation experiment file (notebook or script)",
              "Agent generated a dataset relevant to the agent's functionality",
            ],
          }),
        ],
        script: [
          scenario.user(
            "create a batch evaluation experiment for my agent using langwatch.experiment SDK (not scenario tests), short and sweet, no need to run it"
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
          },
          scenario.judge(),
        ],
      });

      expect(result.success).toBe(true);
    },
    600_000
  );
});
