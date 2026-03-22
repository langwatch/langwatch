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

const LOG_PREFIX = chalk.green("[cursor]");

/**
 * Resolves the cursor-agent binary path.
 * Checks CURSOR_BIN env var first, then falls back to `which cursor-agent`.
 */
function resolveCursorBinary(overridePath?: string): string | undefined {
  if (overridePath) {
    return fs.existsSync(overridePath) ? overridePath : undefined;
  }

  if (process.env.CURSOR_BIN) {
    return process.env.CURSOR_BIN;
  }

  try {
    return execSync("which cursor-agent", { encoding: "utf8" }).trim();
  } catch {
    return undefined;
  }
}

/**
 * Cursor runner for the agent adapter factory.
 *
 * Spawns cursor-agent via child_process.spawn with MCP config pointing
 * to the LangWatch MCP server. Normalizes stream-json output internally.
 *
 * Binary: `cursor-agent` (installed via `brew install cursor-cli`)
 * MCP config: `.cursor/mcp.json` in the working directory
 * Skills: `.cursor/rules/<name>/SKILL.md`
 * Config: `.cursorrules`
 */
export class CursorRunner implements AgentRunner {
  readonly name = "cursor";

  readonly capabilities: AgentRunnerCapabilities = {
    supportsMcp: true,
    skillsDirectory: ".cursor/rules",
    configFile: ".cursorrules",
  };

  private readonly binaryPath: string | undefined;

  constructor(overrideBinaryPath?: string) {
    this.binaryPath = resolveCursorBinary(overrideBinaryPath);
  }

  /** Check whether the cursor-agent binary is available. */
  isBinaryAvailable(): boolean {
    return this.binaryPath !== undefined;
  }

  /**
   * Build the CLI arguments for spawning cursor-agent.
   *
   * Exposed for unit testing -- not part of the AgentRunner interface.
   */
  buildArgs({
    prompt,
    workingDirectory,
    includeMcpApproval,
  }: {
    prompt: string;
    workingDirectory: string;
    includeMcpApproval: boolean;
  }): string[] {
    return [
      "-p",
      "--output-format",
      "stream-json",
      "--force",
      "--trust",
      ...(includeMcpApproval ? ["--approve-mcps"] : []),
      "--workspace",
      workingDirectory,
      prompt,
    ];
  }

  /**
   * Parse cursor-agent stream-json NDJSON output into message objects.
   *
   * Cursor uses the same stream-json format name as Claude Code.
   * Extracts objects that contain a `message` property.
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
      .filter((parsed) => parsed !== null && "message" in parsed)
      .map((parsed) => parsed.message);
  }

  createAgent(options: RunnerOptions): AgentAdapter {
    if (!this.binaryPath) {
      throw new Error(
        `[cursor] cursor-agent binary not found. Install it via: brew install cursor-cli (see https://docs.cursor.com/agent-cli)`
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

        if (!skipMcp) {
          const cursorDir = path.join(workingDirectory, ".cursor");
          fs.mkdirSync(cursorDir, { recursive: true });

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
          fs.writeFileSync(
            path.join(cursorDir, "mcp.json"),
            JSON.stringify(mcpConfig)
          );
        }

        return new Promise<AgentReturnTypes>((resolve, reject) => {
          const args = this.buildArgs({
            prompt: formattedMessages,
            workingDirectory,
            includeMcpApproval: !skipMcp,
          });

          console.log(
            LOG_PREFIX,
            chalk.blue("Starting cursor-agent in:"),
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

          // Pass CURSOR_API_KEY via --api-key if available
          const apiKeyArgs = process.env.CURSOR_API_KEY
            ? ["--api-key", process.env.CURSOR_API_KEY]
            : [];

          const child = spawn(binaryPath, [...apiKeyArgs, ...args], {
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
                new Error(
                  `[cursor] Command failed with exit code ${exitCode}`
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
