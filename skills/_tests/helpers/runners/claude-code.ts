import {
  type AgentAdapter,
  type AgentReturnTypes,
  AgentRole,
} from "@langwatch/scenario";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { spawn, execSync } from "child_process";
import chalk from "chalk";
import type {
  AgentRunner,
  AgentRunnerCapabilities,
  RunnerOptions,
} from "../types.js";
import { copySkillTree, generateConfigFile } from "../shared.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const mcpServerDistPath = path.resolve(
  __dirname,
  "../../../../mcp-server/dist/index.js"
);

const LOG_PREFIX = chalk.cyan("[claude-code]");

/**
 * Resolves the Claude Code binary path.
 * Checks CLAUDE_BIN env var first, then falls back to `which claude`.
 */
function resolveClaudeBinary(overridePath?: string): string | undefined {
  if (overridePath) {
    return fs.existsSync(overridePath) ? overridePath : undefined;
  }

  if (process.env.CLAUDE_BIN) {
    return fs.existsSync(process.env.CLAUDE_BIN)
      ? process.env.CLAUDE_BIN
      : undefined;
  }

  try {
    return execSync("which claude", { encoding: "utf8" }).trim();
  } catch {
    return undefined;
  }
}

/**
 * Claude Code runner for the agent adapter factory.
 *
 * Spawns Claude Code via child_process.spawn with MCP config pointing
 * to the LangWatch MCP server. Normalizes stream-json output internally.
 */
export class ClaudeCodeRunner implements AgentRunner {
  readonly name = "claude-code";

  readonly capabilities: AgentRunnerCapabilities = {
    supportsMcp: true,
    skillsDirectory: ".skills",
    configFile: "CLAUDE.md",
  };

  private readonly binaryPath: string | undefined;

  constructor(overrideBinaryPath?: string) {
    this.binaryPath = resolveClaudeBinary(overrideBinaryPath);
  }

  /** Check whether the claude binary is available. */
  isBinaryAvailable(): boolean {
    return this.binaryPath !== undefined;
  }

  /**
   * Build the CLI arguments for spawning Claude Code.
   *
   * Exposed for unit testing -- not part of the AgentRunner interface.
   */
  buildArgs({
    prompt,
    mcpConfigPath,
  }: {
    prompt: string;
    mcpConfigPath: string | undefined;
  }): string[] {
    return [
      "--output-format",
      "stream-json",
      "-p",
      ...(mcpConfigPath ? ["--mcp-config", mcpConfigPath] : []),
      "--dangerously-skip-permissions",
      "--verbose",
      prompt,
    ];
  }

  /**
   * Parse Claude Code stream-json NDJSON output into message objects.
   *
   * Exposed for unit testing.
   */
  parseStreamJsonOutput(output: string): any[] {
    return output
      .split("\n")
      .map((line) => {
        try {
          return JSON.parse(line.trim());
        } catch {
          return null;
        }
      })
      .filter(
        (parsed) => parsed !== null && "message" in parsed
      )
      .map((parsed) => parsed.message);
  }

  createAgent(options: RunnerOptions): AgentAdapter {
    if (!this.binaryPath) {
      throw new Error(
        `[claude-code] Claude Code binary not found. Install it from https://docs.anthropic.com/en/docs/claude-code or set CLAUDE_BIN env var.`
      );
    }

    const { workingDirectory, skillPath, cleanEnv, skipMcp } = options;

    // Copy skill tree if provided
    let skillName: string | undefined;
    if (skillPath) {
      skillName = copySkillTree({
        skillPath,
        workingDirectory,
        skillsDirectory: this.capabilities.skillsDirectory,
      });

      generateConfigFile({
        configFile: this.capabilities.configFile,
        workingDirectory,
        skillsDirectory: this.capabilities.skillsDirectory,
        skillName,
      });
    }

    const binaryPath = this.binaryPath;

    return {
      role: AgentRole.AGENT,
      call: async (state) => {
        const formattedMessages = state.messages
          .map((message) => `${message.role}: ${message.content}`)
          .join("\n\n");

        const mcpConfigPath = path.join(workingDirectory, ".mcp-config.json");

        if (!skipMcp) {
          if (!process.env.LANGWATCH_API_KEY) {
            throw new Error(
              "[claude-code] LANGWATCH_API_KEY is required when MCP is enabled."
            );
          }

          const mcpConfig = {
            mcpServers: {
              LangWatch: {
                command: "node",
                args: [
                  mcpServerDistPath,
                  "--apiKey",
                  process.env.LANGWATCH_API_KEY!,
                ],
              },
            },
          };
          fs.writeFileSync(mcpConfigPath, JSON.stringify(mcpConfig));
        }

        return new Promise<AgentReturnTypes>((resolve, reject) => {
          const args = this.buildArgs({
            prompt: formattedMessages,
            mcpConfigPath: skipMcp ? undefined : mcpConfigPath,
          });

          console.log(LOG_PREFIX, chalk.blue("Starting claude in:"), workingDirectory);

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
              const messages = this.parseStreamJsonOutput(output);
              console.log(
                LOG_PREFIX,
                "messages",
                JSON.stringify(messages, undefined, 2)
              );
              resolve(messages);
            } else {
              reject(
                new Error(`[claude-code] Command failed with exit code ${exitCode}`)
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
