import {
  type AgentAdapter,
  type AgentReturnTypes,
  AgentRole,
} from "@langwatch/scenario";
import fs from "fs";
import { spawn, execSync } from "child_process";
import chalk from "chalk";
import type {
  AgentRunner,
  AgentRunnerCapabilities,
  RunnerOptions,
} from "../types.js";
import { copySkillTree, generateConfigFile } from "../shared.js";

const LOG_PREFIX = chalk.magenta("[codex]");

/**
 * Resolves the Codex binary path.
 * Falls back to `which codex` if no override is provided.
 */
function resolveCodexBinary(overridePath?: string): string | undefined {
  if (overridePath) {
    return fs.existsSync(overridePath) ? overridePath : undefined;
  }

  try {
    return execSync("which codex", { encoding: "utf8" }).trim();
  } catch {
    return undefined;
  }
}

/**
 * Codex runner for the agent adapter factory.
 *
 * Spawns Codex via `codex exec --full-auto --json <prompt>`.
 * Parses JSONL output with event types: thread.started, item.completed, turn.completed.
 * Extracts assistant message content from item.completed events.
 *
 * No MCP support -- capabilities.supportsMcp is false.
 */
export class CodexRunner implements AgentRunner {
  readonly name = "codex";

  readonly capabilities: AgentRunnerCapabilities = {
    supportsMcp: false,
    skillsDirectory: ".agents/skills",
    configFile: undefined,
  };

  private readonly binaryPath: string | undefined;

  constructor(overrideBinaryPath?: string) {
    this.binaryPath = resolveCodexBinary(overrideBinaryPath);
  }

  /** Check whether the codex binary is available. */
  isBinaryAvailable(): boolean {
    return this.binaryPath !== undefined;
  }

  /**
   * Build the CLI arguments for spawning Codex.
   *
   * Exposed for unit testing.
   */
  buildArgs({ prompt }: { prompt: string }): string[] {
    return ["exec", "--full-auto", "--skip-git-repo-check", "--json", prompt];
  }

  /**
   * Parse Codex JSONL output into message objects compatible with @langwatch/scenario.
   *
   * Extracts assistant message content from item.completed events where the
   * item type is "message" and role is "assistant". Normalizes output_text
   * content blocks to text blocks for SDK compatibility.
   *
   * Exposed for unit testing.
   */
  parseJsonlOutput(output: string): any[] {
    return output
      .split("\n")
      .map((line) => {
        try {
          return JSON.parse(line.trim());
        } catch {
          return null;
        }
      })
      .filter((parsed): parsed is Record<string, any> => {
        if (parsed === null) return false;
        if (parsed.type !== "item.completed") return false;
        if (!parsed.item) return false;
        if (parsed.item.type !== "message") return false;
        if (parsed.item.role !== "assistant") return false;
        return true;
      })
      .map((parsed) => {
        // Normalize output_text blocks to text blocks
        const content = Array.isArray(parsed.item.content)
          ? parsed.item.content
              .map((block: { type: string; text?: string }) => ({
                type: "text",
                text: block.text ?? "",
              }))
              .filter((block: { text: string }) => block.text !== "")
          : parsed.item.content;

        return {
          role: parsed.item.role,
          content,
        };
      });
  }

  createAgent(options: RunnerOptions): AgentAdapter {
    if (!this.binaryPath) {
      throw new Error(
        `[codex] Codex binary not found. Install it from https://github.com/openai/codex or via npm: npm install -g @openai/codex`
      );
    }

    const { workingDirectory, skillPath, cleanEnv } = options;

    // Copy skill tree if provided
    if (skillPath) {
      const skillName = copySkillTree({
        skillPath,
        workingDirectory,
        skillsDirectory: this.capabilities.skillsDirectory,
      });

      // Codex has no config file -- generateConfigFile is a no-op
      generateConfigFile({
        configFile: this.capabilities.configFile,
        workingDirectory,
        skillsDirectory: this.capabilities.skillsDirectory,
        skillName,
      });
    }

    // MCP is not supported; no config file is written regardless of skipMcp

    const binaryPath = this.binaryPath;

    return {
      role: AgentRole.AGENT,
      call: async (state) => {
        const formattedMessages = state.messages
          .map((message) => `${message.role}: ${message.content}`)
          .join("\n\n");

        return new Promise<AgentReturnTypes>((resolve, reject) => {
          const args = this.buildArgs({ prompt: formattedMessages });

          console.log(
            LOG_PREFIX,
            chalk.blue("Starting codex in:"),
            workingDirectory
          );

          const envVars = cleanEnv
            ? Object.fromEntries(
                Object.entries(process.env).filter(
                  ([key]) =>
                    ![
                      "LANGWATCH_API_KEY",
                      "OPENAI_API_KEY",
                      "ANTHROPIC_API_KEY",
                    ].includes(key)
                )
              )
            : process.env;

          const child = spawn(binaryPath, args, {
            cwd: workingDirectory,
            env: { ...envVars, FORCE_COLOR: "0" },
            stdio: ["ignore", "pipe", "pipe"],
          });

          let output = "";

          child.stdout.on("data", (data: Buffer) => {
            const text = data.toString();
            console.log(LOG_PREFIX, text);
            output += text;
          });

          child.stderr.on("data", (data: Buffer) => {
            console.log(LOG_PREFIX, chalk.yellow("stderr:"), data.toString());
          });

          child.on("close", (exitCode) => {
            if (exitCode === 0) {
              const messages = this.parseJsonlOutput(output);
              console.log(
                LOG_PREFIX,
                "messages",
                JSON.stringify(messages, undefined, 2)
              );
              resolve(messages);
            } else {
              reject(
                new Error(
                  `[codex] Command failed with exit code ${exitCode}`
                )
              );
            }
          });

          child.on("error", (err) => {
            reject(err);
          });
        });
      },
    };
  }
}
