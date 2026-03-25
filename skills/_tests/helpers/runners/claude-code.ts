import { AgentRole } from "@langwatch/scenario";
import type { AgentAdapter } from "@langwatch/scenario";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { execSync } from "child_process";

import type { AgentRunner, AgentRunnerCapabilities, RunnerOptions } from "../types.js";
import { placeSkill } from "../shared.js";
import { spawnRunner } from "../spawn-runner.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const mcpServerDistPath = path.resolve(
  __dirname,
  "../../../../mcp-server/dist/index.js"
);

/**
 * Parses Claude Code stream-json output into message objects.
 *
 * Each line is a JSON object; lines with a `message` property are
 * extracted and unwrapped.
 */
function parseClaudeCodeOutput(output: string): unknown[] {
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
 * Runner for Claude Code CLI.
 *
 * Spawns `claude` via child_process.spawn with stream-json output format.
 * Handles CLAUDE.md auto-generation, MCP config, and skill placement in
 * the `.skills/` directory.
 */
export class ClaudeCodeRunner implements AgentRunner {
  readonly name = "claude-code";

  readonly capabilities: AgentRunnerCapabilities = {
    supportsMcp: true,
    skillsDirectory: ".skills",
    configFile: "CLAUDE.md",
  };

  createAgent(options: RunnerOptions): AgentAdapter {
    const { workingDirectory, skillPath, cleanEnv, skipMcp } = options;

    if (skillPath) {
      placeSkill({
        workingDirectory,
        skillsDirectory: this.capabilities.skillsDirectory,
        skillPath,
      });
    }

    // Claude Code doesn't auto-discover .skills/ in arbitrary directories.
    // If .skills/ exists but no CLAUDE.md points to it, create one.
    const skillsDir = path.join(
      workingDirectory,
      this.capabilities.skillsDirectory
    );
    const claudeMdPath = path.join(workingDirectory, "CLAUDE.md");
    if (fs.existsSync(skillsDir) && !fs.existsSync(claudeMdPath)) {
      const skillDirs = fs
        .readdirSync(skillsDir, { withFileTypes: true })
        .filter(
          (d) =>
            d.isDirectory() &&
            fs.existsSync(path.join(skillsDir, d.name, "SKILL.md"))
        );
      if (skillDirs.length > 0) {
        const instructions = skillDirs
          .map((d) => `.skills/${d.name}/SKILL.md`)
          .join(" and ");
        fs.writeFileSync(
          claudeMdPath,
          `Read and follow the instructions in ${instructions} before doing anything else.\n`
        );
      }
    }

    return {
      role: AgentRole.AGENT,
      call: async (state) => {
        const formattedMessages = state.messages
          .map((message) => `${message.role}: ${message.content}`)
          .join("\n\n");

        const mcpConfigPath = path.join(workingDirectory, ".mcp-config.json");

        if (!skipMcp) {
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

        const claudeBin =
          process.env.CLAUDE_BIN ||
          execSync("which claude", { encoding: "utf8" }).trim();

        const args = [
          "--output-format",
          "stream-json",
          "-p",
          ...(skipMcp ? [] : ["--mcp-config", mcpConfigPath]),
          "--dangerously-skip-permissions",
          "--verbose",
          formattedMessages,
        ];

        return spawnRunner({
          binary: claudeBin,
          args,
          workingDirectory,
          cleanEnv,
          label: "Claude Code",
          parseOutput: parseClaudeCodeOutput,
        });
      },
    };
  }
}
