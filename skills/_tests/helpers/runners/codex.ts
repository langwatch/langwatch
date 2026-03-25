import { AgentRole } from "@langwatch/scenario";
import type { AgentAdapter } from "@langwatch/scenario";
import { execSync } from "child_process";

import type { AgentRunner, AgentRunnerCapabilities, RunnerOptions } from "../types.js";
import { placeSkill } from "../shared.js";
import { spawnRunner } from "../spawn-runner.js";

/**
 * Runner for the Codex CLI.
 *
 * Spawns `codex exec --full-auto --json` and parses JSONL output.
 * Codex has no MCP support -- skills are placed in `.agents/skills/`
 * and discovered automatically.
 */
export class CodexRunner implements AgentRunner {
  readonly name = "codex";

  readonly capabilities: AgentRunnerCapabilities = {
    supportsMcp: false,
    skillsDirectory: ".agents/skills",
    configFile: undefined,
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

    // Detect codex binary availability upfront
    let codexBin: string | null = null;
    try {
      codexBin = execSync("which codex", { encoding: "utf8" }).trim();
    } catch {
      // Binary not found -- return an adapter that throws on call()
    }

    if (!codexBin) {
      return {
        role: AgentRole.AGENT,
        call: async () => {
          throw new Error(
            "Codex CLI not found. Install it or set AGENT_UNDER_TEST=claude-code"
          );
        },
      };
    }

    const resolvedBin = codexBin;

    return {
      role: AgentRole.AGENT,
      call: async (state) => {
        const formattedMessages = state.messages
          .map((message) => `${message.role}: ${message.content}`)
          .join("\n\n");

        const args = [
          "exec",
          "--full-auto",
          "--json",
          formattedMessages,
        ];

        return spawnRunner({
          binary: resolvedBin,
          args,
          workingDirectory,
          cleanEnv,
          label: "Codex",
          parseOutput: parseCodexJsonlOutput,
        });
      },
    };
  }
}

/**
 * Parse Codex JSONL output into an array of assistant text messages.
 *
 * Codex emits JSONL events with types like `thread.started`,
 * `item.completed`, and `turn.completed`. We extract assistant text
 * from `item.completed` events that contain message content.
 */
function parseCodexJsonlOutput(output: string): unknown[] {
  const messages: unknown[] = [];

  for (const line of output.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    try {
      const event = JSON.parse(trimmed);

      // Handle item.completed events with assistant messages
      if (event.type === "item.completed" && event.item) {
        const item = event.item;
        if (item.role === "assistant" && item.content) {
          messages.push({
            role: "assistant",
            content: Array.isArray(item.content)
              ? item.content
                  .filter((c: any) => c.type === "text")
                  .map((c: any) => c.text)
                  .join("")
              : item.content,
          });
        }
      }

      // Handle direct message format (fallback)
      if (event.role === "assistant" && event.content) {
        messages.push({
          role: "assistant",
          content: typeof event.content === "string"
            ? event.content
            : JSON.stringify(event.content),
        });
      }

      // Handle message wrapper format
      if ("message" in event && event.message) {
        messages.push(event.message);
      }
    } catch {
      // Skip non-JSON lines
    }
  }

  return messages;
}
