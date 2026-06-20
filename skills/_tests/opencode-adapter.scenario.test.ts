// Live integration proof for the opencode adapter (AC-4).
//
// This asserts TRUE completion: across a real multi-turn coding scenario the
// agent must produce coherent, non-truncated replies (a function plus a test,
// then a follow-up) and the judge must pass. Because completion robustness is
// the property under test, run this manually ~3x to confirm it is not flaky.
//
// It is intentionally env-gapped: skipped in CI, and skipped locally unless the
// `opencode` binary is on PATH AND a provider key (ANTHROPIC_API_KEY) is set.
// opencode resolves its own credentials, so the key must be configured via
// `opencode auth login` or the provider env var before running.
import scenario from "@langwatch/scenario";
import fs from "fs";
import os from "os";
import path from "path";
import { execSync } from "child_process";
import { fileURLToPath } from "url";
import { describe, it, expect } from "vitest";
import dotenv from "dotenv";
import { openai } from "@ai-sdk/openai";
import { SKILL_TESTS_SET_ID } from "./helpers/claude-code-adapter";
import { createOpenCodeAgent } from "./helpers/opencode-adapter";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, "../.env") });

const isCI = !!process.env.CI;
let isOpencodeAvailable = false;
try {
  execSync("which opencode", { stdio: "ignore" });
  isOpencodeAvailable = true;
} catch {
  /* opencode binary not installed */
}
const runLive = !isCI && isOpencodeAvailable && !!process.env.ANTHROPIC_API_KEY;

const judgeModel = openai("gpt-5-mini");

describe("opencode adapter (live)", () => {
  it.skipIf(!runLive)(
    "completes a multi-turn coding task with coherent replies (AC-4)",
    async () => {
      const tempFolder = fs.mkdtempSync(
        path.join(os.tmpdir(), "langwatch-opencode-adapter-")
      );

      const opencodeAgent = createOpenCodeAgent({
        model: { providerID: "openai", modelID: "gpt-5-mini" },
        workingDirectory: tempFolder,
      });
      try {
        const result = await scenario.run({
          setId: SKILL_TESTS_SET_ID,
          name: "opencode multi-turn coding task",
          description:
            "User asks an opencode-driven agent to write a function plus a test, then iterate on it.",
          agents: [
            opencodeAgent,
            scenario.userSimulatorAgent({ model: judgeModel }),
            scenario.judgeAgent({
              model: judgeModel,
              criteria: [
                "Agent wrote a function implementation",
                "Agent wrote a test for that function",
                "Agent's replies are coherent and complete, not truncated mid-thought",
                "Agent addressed the user's follow-up request",
              ],
            }),
          ],
          script: [
            scenario.user(
              "write a small function and a test for it in this directory"
            ),
            scenario.agent(),
            scenario.user("now add a docstring to that function"),
            scenario.agent(),
            scenario.judge(),
          ],
        });

        expect(result.success).toBe(true);
      } finally {
        await opencodeAgent.close();
      }
    },
    900_000
  );
});
