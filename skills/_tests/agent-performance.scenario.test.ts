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
  assertSkillWasRead,
  installSkillToWorkDir,
  SKILL_TESTS_SET_ID,
} from "./helpers/claude-code-adapter";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, "../.env") });

const isCI = !!process.env.CI;
const judgeModel = openai("gpt-5-mini");

function findReport(dir: string): string | undefined {
  const candidates = fs
    .readdirSync(dir)
    .filter((f) => f.endsWith(".html"))
    .map((f) => path.join(dir, f));
  // The skill names it agent-performance-report.html; accept any html report
  // but prefer the canonical name so drift is visible in the assertion output.
  return (
    candidates.find((f) => f.endsWith("agent-performance-report.html")) ?? candidates[0]
  );
}

describe("Agent Performance Skill", () => {
  it.skipIf(isCI)(
    "diagnoses production behavior and delivers an HTML report with trace links",
    async () => {
      const tempFolder = fs.mkdtempSync(
        path.join(os.tmpdir(), "langwatch-skill-agent-performance-")
      );

      installSkillToWorkDir({
        workingDirectory: tempFolder,
        skillSubpath: "agent-performance",
      });

      const result = await scenario.run({
        setId: SKILL_TESTS_SET_ID,
        name: "Agent performance deep diagnosis",
        description:
          "User wants a full diagnosis of how their production agent is behaving: patterns, failures, costs, outliers. The project already has production traces in LangWatch.",
        agents: [
          createClaudeCodeAgent({ workingDirectory: tempFolder }),
          scenario.userSimulatorAgent({ model: judgeModel }),
          scenario.judgeAgent({
            model: judgeModel,
            criteria: [
              "Agent used `langwatch analytics query` for aggregate metrics AND `langwatch trace export`, `langwatch trace search`, or `langwatch trace get` to examine actual traces",
              "Agent presented concrete findings with numbers (counts, costs, latencies, or rates), not raw JSON dumps",
              "Agent backed findings with specific example traces (trace IDs or trace links)",
              "Agent produced an HTML report file and told the user where it is",
              "Agent recommended the agent-improvement skill as the next step (running it or installing it via `npx skills add langwatch/skills/agent-improvement`)",
              "Agent did NOT modify any code or create any platform resources (read-only diagnosis)",
            ],
          }),
        ],
        script: [
          scenario.user(
            "how is my agent performing? give me the full picture of what is going on in production"
          ),
          scenario.agent(),
          (state) => {
            toolCallFix(state);
            assertSkillWasRead(state, "agent-performance");

            const report = findReport(tempFolder);
            expect(
              report,
              `Expected an HTML diagnosis report in ${tempFolder}`
            ).toBeDefined();

            const html = fs.readFileSync(report!, "utf8").toLowerCase();
            expect(
              html.length,
              "Report is too small to be a real diagnosis"
            ).toBeGreaterThan(2000);
            expect(
              html.includes("langwatch"),
              "Report must link findings to traces in the LangWatch app"
            ).toBe(true);
            const hasTraceLinks =
              /https?:\/\/[^"'\s]*langwatch[^"'\s]*/i.test(html) ||
              html.includes("trace_");
            expect(
              hasTraceLinks,
              "Report must contain links or IDs of example traces"
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
