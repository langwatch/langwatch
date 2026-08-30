import scenario, { type ScenarioExecutionStateLike } from "@langwatch/scenario";
import fs from "fs";
import { describe, it, expect } from "vitest";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import { openai } from "@ai-sdk/openai";
import {
  assertSkillWasRead,
  copyFixtureToWorkDir,
  createClaudeCodeAgent,
  createSkillTestWorkDir,
  installSkillToWorkDir,
  removeSkillTestWorkDir,
  SKILL_TESTS_SET_ID,
  toolCallFix,
} from "./helpers/claude-code-adapter";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, "../.env") });

const isCI = !!process.env.CI;

const judgeModel = openai("gpt-5-mini");

function findFiles(dir: string, pattern: RegExp): string[] {
  const results: string[] = [];
  if (!fs.existsSync(dir)) return results;

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (
      entry.isDirectory() &&
      entry.name !== "node_modules" &&
      entry.name !== ".venv" &&
      entry.name !== "venv" &&
      entry.name !== ".git"
    ) {
      results.push(...findFiles(fullPath, pattern));
    } else if (entry.isFile() && pattern.test(entry.name)) {
      results.push(fullPath);
    }
  }
  return results;
}

function readAll(files: string[]): string {
  return files.map((f) => fs.readFileSync(f, "utf8")).join("\n");
}

function transcriptText(state: ScenarioExecutionStateLike): string {
  return state.messages
    .map((m) =>
      typeof m.content === "string" ? m.content : JSON.stringify(m.content ?? ""),
    )
    .join("\n")
    .replace(/\\/g, "");
}

describe("Connect Agent Skill", () => {
  /** @scenario Connect-agent skill wires a FastAPI agent for platform simulations */
  it.skipIf(isCI)(
    "connects a FastAPI chat agent to platform simulations over HTTP",
    async () => {
      const tempFolder = createSkillTestWorkDir("langwatch-skill-connect-agent-");
      console.log(`[connect-agent dogfood] working dir: ${tempFolder}`);

      try {
        copyFixtureToWorkDir({
          fixtureSubpath: "python-fastapi-chat",
          workingDirectory: tempFolder,
        });
        installSkillToWorkDir({
          workingDirectory: tempFolder,
          skillSubpath: "connect-agent",
        });

        // Authenticate the CLI inside the workdir when a key is available. The
        // test still passes without one: CLI steps only need to be ATTEMPTED,
        // and the judge checks the agent reported any platform failure instead
        // of claiming success.
        const apiKey = process.env.LANGWATCH_API_KEY?.trim();
        if (apiKey) {
          const endpoint = process.env.LANGWATCH_ENDPOINT?.trim();
          fs.writeFileSync(
            path.join(tempFolder, ".env"),
            `LANGWATCH_API_KEY=${apiKey}\n` +
              (endpoint ? `LANGWATCH_ENDPOINT=${endpoint}\n` : ""),
          );
        }

        const result = await scenario.run({
          setId: SKILL_TESTS_SET_ID,
          name: "Connect a FastAPI agent to simulations",
          description:
            "The user has a FastAPI chat agent with cookie-session auth and no OpenTelemetry. " +
            "The connect-agent skill must make the server adopt the incoming traceparent, add a " +
            "dedicated scenario key path without weakening the session auth, and register the " +
            "agent on the platform via the langwatch CLI.",
          agents: [
            createClaudeCodeAgent({ workingDirectory: tempFolder }),
            scenario.userSimulatorAgent({ model: judgeModel }),
            scenario.judgeAgent({
              model: judgeModel,
              criteria: [
                "Agent read the connect-agent skill instructions before acting",
                "Agent made the chat endpoint adopt the incoming W3C traceparent header (OpenTelemetry context extraction in the server code)",
                "Agent added a dedicated scenario authentication path (an environment variable key checked against the Authorization Bearer header) and did NOT weaken or remove the existing session authentication for normal traffic",
                "Agent attempted to register the HTTP agent with `langwatch agent create` (the command is visible in the transcript)",
                "If any `langwatch` platform command failed or the platform was unreachable, the agent reported that failure and did NOT claim a scenario or test suite run succeeded",
              ],
            }),
          ],
          script: [
            scenario.user(
              "connect my agent to LangWatch scenarios so test suites can run against it over HTTP. " +
                "The service is deployed at https://staging.acme-gear.example.com. For the " +
                "scenario key, generate a test value yourself and use it for both the server " +
                "env and the platform secret.",
            ),
            scenario.agent(),
            (state) => {
              toolCallFix(state);
              assertSkillWasRead(state, "connect-agent");

              const pythonFiles = findFiles(tempFolder, /\.py$/);
              expect(
                pythonFiles.length,
                `Expected the fixture's Python files to still exist in ${tempFolder}`,
              ).toBeGreaterThan(0);
              const pythonContent = readAll(pythonFiles);

              // Trace adoption landed in the server code.
              expect(
                pythonContent,
                "Expected the server to adopt the incoming traceparent (propagate.extract or traceparent handling)",
              ).toMatch(/propagate\.extract|traceparent/i);

              // A dedicated env-var scenario auth path exists. The test's own
              // credential .env (written above with the real LANGWATCH_API_KEY)
              // is excluded: a failed assertion prints the received string,
              // and the key must never land in test output. That file never
              // contains a SCENARIO key, so excluding it costs no coverage.
              const credentialEnvPath = path.join(tempFolder, ".env");
              const envFiles = findFiles(tempFolder, /^\.env(\..+)?$/).filter(
                (file) => path.resolve(file) !== path.resolve(credentialEnvPath),
              );
              const authSurface = pythonContent + "\n" + readAll(envFiles);
              expect(
                authSurface,
                "Expected an env-var scenario key path (SCENARIO_API_KEY or equivalent)",
              ).toMatch(/SCENARIO[_A-Z]*KEY/);

              // The existing session auth stayed in place.
              expect(
                pythonContent,
                "Expected the existing session authentication to survive",
              ).toContain("require_session");

              // The registration was attempted, visibly, via the CLI.
              expect(
                transcriptText(state),
                "Expected the agent to run (or at least attempt) `langwatch agent create`",
              ).toContain("langwatch agent create");
            },
            scenario.judge(),
          ],
        });

        expect(result.success).toBe(true);
      } finally {
        removeSkillTestWorkDir(tempFolder);
      }
    },
    // One long autonomous turn: server edits (auth + trace adoption) plus a
    // chain of CLI commands (secret, agent, scenario, test suite, run).
    1_800_000,
  );
});
