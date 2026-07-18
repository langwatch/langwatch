import "dotenv/config";

import scenario, {
  type AgentAdapter,
  AgentRole,
  setupScenarioTracing,
} from "@langwatch/scenario";
import { openai } from "@ai-sdk/openai";
import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

setupScenarioTracing();

// Judge agents need a provider model, not an AI Gateway model-id string, so
// the documented OPENAI_API_KEY is used directly.
const DEFAULT_MODEL = openai("gpt-5-mini");

/**
 * Claude Code is the system under test. Each scenario gets an isolated fixture
 * directory and loads the plugin from this package with --plugin-dir, exactly
 * as a developer would when testing a local Claude Code plugin.
 */
const pluginDirectory = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  ".."
);

function hasClaudeCode(): boolean {
  try {
    execFileSync(process.env.CLAUDE_BIN ?? "claude", ["--version"], {
      stdio: "ignore",
    });
    return true;
  } catch {
    return false;
  }
}

export const canRunLiveScenarios =
  process.env.RUN_CODING_AGENT_SCENARIOS === "1" &&
  Boolean(process.env.OPENAI_API_KEY) &&
  hasClaudeCode();

function renderContent(content: unknown): string {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return JSON.stringify(content);

  return content
    .map((block: any) => {
      if (typeof block === "string") return block;
      if (block?.type === "text") return block.text ?? "";
      return JSON.stringify(block);
    })
    .filter(Boolean)
    .join("\n");
}

function createFixture(): string {
  const workingDirectory = fs.mkdtempSync(
    path.join(os.tmpdir(), "langwatch-coding-agent-scenarios-")
  );

  fs.mkdirSync(path.join(workingDirectory, "src/pkg"), { recursive: true });
  fs.mkdirSync(path.join(workingDirectory, "src/services"), { recursive: true });
  fs.writeFileSync(
    path.join(workingDirectory, "go.mod"),
    "module example.com/coding-agent-scenarios\\n\\ngo 1.23\\n"
  );
  fs.writeFileSync(
    path.join(workingDirectory, "src/pkg/handler.go"),
    "package pkg\\n\\nfunc ProcessRequest() {}\\nfunc HandleRequest() {}\\n"
  );
  fs.writeFileSync(
    path.join(workingDirectory, "tsconfig.json"),
    JSON.stringify({ compilerOptions: { strict: true, target: "ES2022" } })
  );
  fs.writeFileSync(
    path.join(workingDirectory, "src/services/UserService.ts"),
    "export class UserService {}\\nexport function fetchUser() { return new UserService(); }\\n"
  );
  fs.writeFileSync(
    path.join(workingDirectory, "CLAUDE.md"),
    "Use the coding-agents plugin skills for Go and TypeScript questions. These are documentation scenarios: explain the commands and workflow, but do not modify the fixture files.\\n"
  );

  return workingDirectory;
}

const claudeCodeAgent = (): AgentAdapter => {
  const workingDirectory = createFixture();

  return {
    role: AgentRole.AGENT,
    call: async (state) => {
      const formattedMessages = state.messages
        .map(
          (message) =>
            `${message.role}: ${renderContent(message.content)}`
        )
        .join("\n\n");
      const claudeBin = process.env.CLAUDE_BIN ?? "claude";
      const args = [
        "--plugin-dir",
        pluginDirectory,
        "--output-format",
        "stream-json",
        "--verbose",
        "--dangerously-skip-permissions",
        "-p",
        formattedMessages,
      ];

      return new Promise((resolve, reject) => {
        const child = spawn(claudeBin, args, {
          cwd: workingDirectory,
          env: { ...process.env, FORCE_COLOR: "0" },
          stdio: ["ignore", "pipe", "pipe"],
        });
        let output = "";
        let errorOutput = "";

        child.stdout.on("data", (chunk) => {
          output += chunk.toString();
        });
        child.stderr.on("data", (chunk) => {
          errorOutput += chunk.toString();
        });
        child.on("error", reject);
        child.on("close", (exitCode) => {
          if (exitCode !== 0) {
            reject(new Error(`Claude Code exited with ${exitCode}: ${errorOutput}`));
            return;
          }

          const messages = output
            .split("\n")
            .map((line) => {
              try {
                return JSON.parse(line.trim());
              } catch {
                return null;
              }
            })
            .filter((message): message is { message: unknown } => Boolean(message?.message))
            .map((message) => message.message);

          resolve(
            messages.length > 0
              ? messages.map((message) => renderContent(message)).join("\n")
              : output.trim()
          );
        });
      });
    },
  };
};

describe.skipIf(!canRunLiveScenarios)("Engineer Skills - Type-Aware Code Navigation", () => {

  describe("Go Engineer Skill (gopls)", () => {

    it("should recognize Go code and use gopls for definitions", async () => {
      const result = await scenario.run({
        name: "Go code - find definition",
        description: "User asks to find the definition of a Go symbol",
        agents: [
          claudeCodeAgent(),
          scenario.userSimulatorAgent(),
          scenario.judgeAgent({ model: DEFAULT_MODEL, criteria: [
              "Agent should use gopls for Go code",
              "Agent should use definition command",
              "Agent should reference the go-engineer skill",
            ],
          }),
        ],
        script: [
          scenario.user("I need to find where the ProcessRequest function is defined in my Go code. It's in src/pkg/handler.go."),
          scenario.agent(),
          scenario.judge(),
        ],
      });

      expect(result.success).toBe(true);
    }, 60_000);

    it("should use gopls for finding Go symbol references", async () => {
      const result = await scenario.run({
        name: "Go code - find references",
        description: "User asks to find all references to a Go symbol",
        agents: [
          claudeCodeAgent(),
          scenario.userSimulatorAgent(),
          scenario.judgeAgent({ model: DEFAULT_MODEL, criteria: [
              "Agent should use gopls references command",
              "Agent should understand type-aware navigation",
            ],
          }),
        ],
        script: [
          scenario.user("I need to find all places where the User struct is referenced in my Go project."),
          scenario.agent(),
          scenario.judge(),
        ],
      });

      expect(result.success).toBe(true);
    }, 60_000);

    it("should use gopls rename preview for safe refactoring", async () => {
      const result = await scenario.run({
        name: "Go code - safe rename",
        description: "User wants to rename a Go symbol safely",
        agents: [
          claudeCodeAgent(),
          scenario.userSimulatorAgent(),
          scenario.judgeAgent({ model: DEFAULT_MODEL, criteria: [
              "Agent should use gopls rename command",
              "Agent should always use gopls rename -d to preview first",
              "Agent demonstrates safe refactoring practice",
            ],
          }),
        ],
        script: [
          scenario.user("I want to rename the handleRequest function to processRequest in my Go code. Please show the safe references, preview, apply, and verification workflow."),
          scenario.agent(),
          scenario.judge(),
        ],
      });

      expect(result.success).toBe(true);
    }, 60_000);

    it("should explain why gopls is better than grep for Go", async () => {
      const result = await scenario.run({
        name: "Go code - type-aware vs text-based",
        description: "User asks why not just use grep for Go code",
        agents: [
          claudeCodeAgent(),
          scenario.userSimulatorAgent(),
          scenario.judgeAgent({ model: DEFAULT_MODEL, criteria: [
              "Agent should explain gopls understands semantic relationships",
              "Agent should mention grep misses re-exports and aliases",
              "Agent should reference the go-engineer skill",
            ],
          }),
        ],
        script: [
          scenario.user("Why can't I just use grep to find Go function definitions? What's the difference?"),
          scenario.agent(),
          scenario.judge(),
        ],
      });

      expect(result.success).toBe(true);
    }, 60_000);
  });

  describe("TypeScript Engineer Skill (tslsp-cli)", () => {

    it("should recognize TypeScript code and use tslsp-cli for definitions", async () => {
      const result = await scenario.run({
        name: "TypeScript code - find definition",
        description: "User asks to find the definition of a TypeScript symbol",
        agents: [
          claudeCodeAgent(),
          scenario.userSimulatorAgent(),
          scenario.judgeAgent({ model: DEFAULT_MODEL, criteria: [
              "Agent should use tslsp-cli for TypeScript code",
              "Agent should use definition command",
              "Agent should reference the ts-engineer skill",
            ],
          }),
        ],
        script: [
          scenario.user("I need to find where the UserService class is defined in my TypeScript project."),
          scenario.agent(),
          scenario.judge(),
        ],
      });

      expect(result.success).toBe(true);
    }, 60_000);

    it("should use tslsp-cli for finding TypeScript symbol references", async () => {
      const result = await scenario.run({
        name: "TypeScript code - find references",
        description: "User asks to find all references to a TypeScript symbol",
        agents: [
          claudeCodeAgent(),
          scenario.userSimulatorAgent(),
          scenario.judgeAgent({ model: DEFAULT_MODEL, criteria: [
              "Agent should use tslsp-cli references command",
              "Agent should use --summary for popular symbols",
              "Agent should understand type-aware navigation",
            ],
          }),
        ],
        script: [
          scenario.user("I need to find all places where the fetchUser function is used in my TypeScript codebase."),
          scenario.agent(),
          scenario.judge(),
        ],
      });

      expect(result.success).toBe(true);
    }, 60_000);

    it("should use tslsp-cli rename with dry-run for safe refactoring", async () => {
      const result = await scenario.run({
        name: "TypeScript code - safe rename",
        description: "User wants to rename a TypeScript symbol safely",
        agents: [
          claudeCodeAgent(),
          scenario.userSimulatorAgent(),
          scenario.judgeAgent({ model: DEFAULT_MODEL, criteria: [
              "Agent should use tslsp-cli rename command",
              "Agent should always use --dry-run first",
              "Agent demonstrates safe refactoring practice",
            ],
          }),
        ],
        script: [
          scenario.user("I want to rename the userAccount variable to userProfile in my TypeScript code. Please show the safe references, --dry-run preview, apply, and diagnostics workflow."),
          scenario.agent(),
          scenario.judge(),
        ],
      });

      expect(result.success).toBe(true);
    }, 60_000);

    it("should explain why tslsp-cli is better than grep for TypeScript", async () => {
      const result = await scenario.run({
        name: "TypeScript code - type-aware vs text-based",
        description: "User asks why not just use grep for TypeScript code",
        agents: [
          claudeCodeAgent(),
          scenario.userSimulatorAgent(),
          scenario.judgeAgent({ model: DEFAULT_MODEL, criteria: [
              "Agent should explain tslsp-cli understands semantic relationships",
              "Agent should mention grep misses re-exports and alias imports",
              "Agent should reference the ts-engineer skill",
            ],
          }),
        ],
        script: [
          scenario.user("Why can't I just use grep to find TypeScript function definitions? What's the difference?"),
          scenario.agent(),
          scenario.judge(),
        ],
      });

      expect(result.success).toBe(true);
    }, 60_000);
  });

  describe("Multi-turn scenarios", () => {

    it("should handle a multi-turn Go refactoring conversation", async () => {
      const result = await scenario.run({
        name: "Multi-turn Go refactoring",
        description: "User wants to refactor Go code with multiple steps",
        agents: [
          claudeCodeAgent(),
          scenario.userSimulatorAgent(),
          scenario.judgeAgent({ model: DEFAULT_MODEL, criteria: [
              "Agent should use gopls for all Go operations",
              "Agent should follow safe refactoring practices",
              "Agent should verify with gopls check after changes",
            ],
          }),
        ],
        script: [
          scenario.user("I have a Go function called HandleRequest that I want to rename to ProcessRequest. Please outline references, gopls rename -d, gopls rename -w, and gopls check."),
          scenario.agent(),
          scenario.user("Should I check for any references first before renaming?"),
          scenario.agent(),
          scenario.judge(),
        ],
      });

      expect(result.success).toBe(true);
    }, 90_000);

    it("should handle a multi-turn TypeScript refactoring conversation", async () => {
      const result = await scenario.run({
        name: "Multi-turn TypeScript refactoring",
        description: "User wants to refactor TypeScript code with multiple steps",
        agents: [
          claudeCodeAgent(),
          scenario.userSimulatorAgent(),
          scenario.judgeAgent({ model: DEFAULT_MODEL, criteria: [
              "Agent should use tslsp-cli for all TypeScript operations",
              "Agent should follow safe refactoring practices",
              "Agent should use batch operations where appropriate",
            ],
          }),
        ],
        script: [
          scenario.user("I have a TypeScript class called UserManager that I want to rename to AccountManager. Please outline references, a --dry-run preview, applying the rename, and diagnostics."),
          scenario.agent(),
          scenario.user("What about the imports? Will they be updated automatically?"),
          scenario.agent(),
          scenario.judge(),
        ],
      });

      expect(result.success).toBe(true);
    }, 90_000);
  });

  describe("Edge cases and error handling", () => {

    it("should handle Go code without position information", async () => {
      const result = await scenario.run({
        name: "Go code - no position info",
        description: "User asks about Go code but doesn't provide file position",
        agents: [
          claudeCodeAgent(),
          scenario.userSimulatorAgent(),
          scenario.judgeAgent({ model: DEFAULT_MODEL, criteria: [
              "Agent should still use gopls",
              "Agent should ask for clarification or use workspace search",
            ],
          }),
        ],
        script: [
          scenario.user("I need to find where ProcessRequest is defined somewhere in my Go project."),
          scenario.agent(),
          scenario.judge(),
        ],
      });

      expect(result.success).toBe(true);
    }, 60_000);

    it("should handle TypeScript code with complex import patterns", async () => {
      const result = await scenario.run({
        name: "TypeScript code - complex imports",
        description: "User asks about TypeScript code with re-exports and aliases",
        agents: [
          claudeCodeAgent(),
          scenario.userSimulatorAgent(),
          scenario.judgeAgent({ model: DEFAULT_MODEL, criteria: [
              "Agent should use tslsp-cli which handles complex imports",
              "Agent should mention that grep would miss these cases",
            ],
          }),
        ],
        script: [
          scenario.user("I have a TypeScript symbol that's re-exported through multiple index.ts files. How do I find all references?"),
          scenario.agent(),
          scenario.judge(),
        ],
      });

      expect(result.success).toBe(true);
    }, 60_000);

    it("should recognize when not to use type-aware tools", async () => {
      const result = await scenario.run({
        name: "Non-code files - use text tools",
        description: "User asks about non-code files where type-aware tools don't apply",
        agents: [
          claudeCodeAgent(),
          scenario.userSimulatorAgent(),
          scenario.judgeAgent({ model: DEFAULT_MODEL, criteria: [
              "Agent should recognize type-aware tools don't apply to non-code files",
              "Agent should suggest appropriate tools for the task",
            ],
          }),
        ],
        script: [
          scenario.user("I need to search through my README.md file for documentation. What should I use?"),
          scenario.agent(),
          scenario.judge(),
        ],
      });

      expect(result.success).toBe(true);
    }, 60_000);
  });
});

// Skill effectiveness tracking scenarios
describe.skipIf(!canRunLiveScenarios)("Skill Effectiveness Tracking", () => {

  describe("Go Engineer Skill Effectiveness", () => {

    it("should correctly identify when gopls finds definitions that grep would miss", async () => {
      const result = await scenario.run({
        name: "gopls vs grep - re-exports",
        description: "Demonstrate gopls finding definitions that grep would miss due to re-exports",
        agents: [
          claudeCodeAgent(),
          scenario.userSimulatorAgent(),
          scenario.judgeAgent({ model: DEFAULT_MODEL, criteria: [
              "Agent should explain gopls handles re-exports correctly",
              "Agent should demonstrate the limitation of text-based tools",
              "Agent should show the value of type-aware navigation",
            ],
          }),
        ],
        script: [
          scenario.user("In my Go code, I have a function that's re-exported from another package. grep doesn't find the original definition. How do I find it?"),
          scenario.agent(),
          scenario.judge(),
        ],
      });

      expect(result.success).toBe(true);
    }, 60_000);

    it("should correctly identify interface implementations with gopls", async () => {
      const result = await scenario.run({
        name: "gopls - interface implementations",
        description: "Demonstrate gopls finding interface implementations",
        agents: [
          claudeCodeAgent(),
          scenario.userSimulatorAgent(),
          scenario.judgeAgent({ model: DEFAULT_MODEL, criteria: [
              "Agent should use gopls implementation command",
              "Agent should explain this requires type analysis",
              "Agent should show grep cannot find interface implementations",
            ],
          }),
        ],
        script: [
          scenario.user("I have a Go interface called Processor. How do I find all structs that implement it?"),
          scenario.agent(),
          scenario.judge(),
        ],
      });

      expect(result.success).toBe(true);
    }, 60_000);

    it("should demonstrate safe Go refactoring workflow", async () => {
      const result = await scenario.run({
        name: "Go safe refactoring workflow",
        description: "Complete workflow for safe Go refactoring using gopls",
        agents: [
          claudeCodeAgent(),
          scenario.userSimulatorAgent(),
          scenario.judgeAgent({ model: DEFAULT_MODEL, criteria: [
              "Agent should demonstrate the full workflow: references → gopls rename -d preview → gopls rename -w → gopls check",
              "Agent should emphasize safety at each step",
              "Agent should show type-aware tools prevent breaking changes",
            ],
          }),
        ],
        script: [
          scenario.user("What's the safest way to rename a Go function that's used in multiple packages? Include references, gopls rename -d preview, gopls rename -w apply, and gopls check verification."),
          scenario.agent(),
          scenario.judge(),
        ],
      });

      expect(result.success).toBe(true);
    }, 60_000);
  });

  describe("TypeScript Engineer Skill Effectiveness", () => {

    it("should correctly identify when tslsp-cli finds references that grep would miss", async () => {
      const result = await scenario.run({
        name: "tslsp-cli vs grep - re-exports and aliases",
        description: "Demonstrate tslsp-cli finding references that grep would miss due to re-exports and alias imports",
        agents: [
          claudeCodeAgent(),
          scenario.userSimulatorAgent(),
          scenario.judgeAgent({ model: DEFAULT_MODEL, criteria: [
              "Agent should explain tslsp-cli handles re-exports and aliases correctly",
              "Agent should demonstrate the limitation of text-based tools",
              "Agent should show the value of type-aware navigation",
            ],
          }),
        ],
        script: [
          scenario.user("In my TypeScript code, I have a function that's imported with an alias. grep doesn't find all usages. How do I find them all?"),
          scenario.agent(),
          scenario.judge(),
        ],
      });

      expect(result.success).toBe(true);
    }, 60_000);

    it("should correctly handle TypeScript file moves with import updates", async () => {
      const result = await scenario.run({
        name: "tslsp-cli - file move with import updates",
        description: "Demonstrate tslsp-cli handling file moves and updating imports",
        agents: [
          claudeCodeAgent(),
          scenario.userSimulatorAgent(),
          scenario.judgeAgent({ model: DEFAULT_MODEL, criteria: [
              "Agent should use tslsp-cli rename-file command",
              "Agent should explain imports are updated automatically",
              "Agent should emphasize this is safer than manual move",
            ],
          }),
        ],
        script: [
          scenario.user("I need to move a TypeScript file from src/utils/helper.ts to src/services/helper.ts. How do I update all the imports?"),
          scenario.agent(),
          scenario.judge(),
        ],
      });

      expect(result.success).toBe(true);
    }, 60_000);

    it("should demonstrate batch operations for efficiency", async () => {
      const result = await scenario.run({
        name: "tslsp-cli batch operations",
        description: "Demonstrate tslsp-cli batch operations for multiple symbols",
        agents: [
          claudeCodeAgent(),
          scenario.userSimulatorAgent(),
          scenario.judgeAgent({ model: DEFAULT_MODEL, criteria: [
              "Agent should use batch operations with multiple symbols",
              "Agent should explain batch operations save tokens and round-trips",
              "Agent should show how to find multiple definitions at once",
            ],
          }),
        ],
        script: [
          scenario.user("I need to find the definitions of UserService, AuthService, and Logger in my TypeScript project. Can I do this in one command?"),
          scenario.agent(),
          scenario.judge(),
        ],
      });

      expect(result.success).toBe(true);
    }, 60_000);
  });

  describe("Comparative effectiveness", () => {

    it("should explain the difference between gopls and tslsp-cli", async () => {
      const result = await scenario.run({
        name: "gopls vs tslsp-cli comparison",
        description: "Explain the differences and similarities between Go and TypeScript type-aware tools",
        agents: [
          claudeCodeAgent(),
          scenario.userSimulatorAgent(),
          scenario.judgeAgent({ model: DEFAULT_MODEL, criteria: [
              "Agent should explain both are type-aware language servers",
              "Agent should mention both replace text-based tools",
              "Agent should note the differences in commands and position formats",
            ],
          }),
        ],
        script: [
          scenario.user("What's the difference between how gopls works for Go and how tslsp-cli works for TypeScript?"),
          scenario.agent(),
          scenario.judge(),
        ],
      });

      expect(result.success).toBe(true);
    }, 60_000);

    it("should handle a mixed codebase scenario", async () => {
      const result = await scenario.run({
        name: "Mixed codebase - Go and TypeScript",
        description: "User works with both Go and TypeScript in the same project",
        agents: [
          claudeCodeAgent(),
          scenario.userSimulatorAgent(),
          scenario.judgeAgent({ model: DEFAULT_MODEL, criteria: [
              "Agent should correctly switch between gopls and tslsp-cli",
              "Agent should recognize the language context",
              "Agent should use the appropriate skill for each language",
            ],
          }),
        ],
        script: [
          scenario.user("I'm working on a project with both Go backend and TypeScript frontend. I need to rename a function in the Go API. What should I use?"),
          scenario.agent(),
          scenario.user("And if I need to rename a function in the TypeScript frontend?"),
          scenario.agent(),
          scenario.judge(),
        ],
      });

      expect(result.success).toBe(true);
    }, 90_000);
  });
});
