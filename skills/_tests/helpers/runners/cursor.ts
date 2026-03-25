import { AgentRole } from "@langwatch/scenario";
import type { AgentAdapter } from "@langwatch/scenario";
import { execSync } from "child_process";

import type { AgentRunner, AgentRunnerCapabilities, RunnerOptions } from "../types.js";
import { placeSkill } from "../shared.js";
import { spawnRunner } from "../spawn-runner.js";

/**
 * Parses Cursor CLI JSON output into message objects.
 *
 * Uses the same JSONL `.message` wrapper format as Claude Code.
 */
function parseCursorOutput(output: string): unknown[] {
  return output
    .split("\n")
    .map((line) => {
      try {
        return JSON.parse(line.trim());
      } catch {
        return null;
      }
    })
    .filter((message) => message !== null && "message" in message)
    .map((message) => message.message);
}

/**
 * Runner for the Cursor CLI.
 *
 * Cursor CLI agent mode is newer and less documented. This implementation
 * detects the binary and attempts basic invocation. If the `cursor` binary
 * is not installed or does not support agent mode, tests are skipped
 * gracefully with a descriptive error.
 *
 * Skills are placed in `.cursor/skills/<name>/SKILL.md`.
 */
export class CursorRunner implements AgentRunner {
  readonly name = "cursor";

  readonly capabilities: AgentRunnerCapabilities = {
    // Cursor CLI does not yet support MCP config in non-interactive agent mode.
    // Set to true once Cursor adds --mcp-config or equivalent flag support.
    supportsMcp: false,
    skillsDirectory: ".cursor/skills",
  };

  createAgent(options: RunnerOptions): AgentAdapter {
    const { workingDirectory, skillPath, cleanEnv } = options;

    if (skillPath) {
      placeSkill({
        workingDirectory,
        skillsDirectory: this.capabilities.skillsDirectory,
        skillPath,
      });
    }

    // Detect cursor binary availability
    let cursorBin: string | null = null;
    try {
      cursorBin = execSync("which cursor", { encoding: "utf8" }).trim();
    } catch {
      // Binary not found
    }

    if (!cursorBin) {
      return {
        role: AgentRole.AGENT,
        call: async () => {
          throw new Error(
            "Cursor CLI not found or does not support agent mode yet. " +
              "Install it or set AGENT_UNDER_TEST=claude-code"
          );
        },
      };
    }

    const resolvedBin = cursorBin;

    return {
      role: AgentRole.AGENT,
      call: async (state) => {
        const formattedMessages = state.messages
          .map((message) => `${message.role}: ${message.content}`)
          .join("\n\n");

        // Cursor CLI invocation -- flags may evolve as Cursor
        // stabilizes its non-interactive agent mode.
        const args = [
          "--agent",
          "--json",
          "-m",
          formattedMessages,
        ];

        return spawnRunner({
          binary: resolvedBin,
          args,
          workingDirectory,
          cleanEnv,
          label: "Cursor",
          parseOutput: parseCursorOutput,
        });
      },
    };
  }
}
