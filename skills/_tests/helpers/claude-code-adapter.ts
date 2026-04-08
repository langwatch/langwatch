import {
  type AgentAdapter,
  AgentRole,
  type ScenarioExecutionStateLike,
} from "@langwatch/scenario";
import { expect } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { spawn, execSync } from "child_process";
import chalk from "chalk";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const mcpServerDistPath = path.resolve(
  __dirname,
  "../../../mcp-server/dist/index.js"
);

/**
 * Creates a Claude Code agent adapter for use with @langwatch/scenario.
 *
 * Spawns Claude Code via child_process.spawn with MCP config pointing to the
 * LangWatch MCP server. Optionally copies a SKILL.md into the working directory
 * so Claude Code auto-discovers it.
 *
 * @param workingDirectory - The directory to run Claude Code in
 * @param skillPath - Optional path to a SKILL.md to copy into the working directory
 * @param cleanEnv - When true, strips LANGWATCH_API_KEY, OPENAI_API_KEY, and
 *   ANTHROPIC_API_KEY from the spawned process environment. Use this to test
 *   cold-start flows where the agent must discover keys from .env files.
 * @param skipMcp - When true, omits the MCP config entirely. Use this to test
 *   flows where the agent must discover docs via llms.txt fallback URLs.
 */
export function createClaudeCodeAgent({
  workingDirectory,
  skillPath,
  cleanEnv,
  skipMcp,
}: {
  workingDirectory: string;
  skillPath?: string;
  cleanEnv?: boolean;
  skipMcp?: boolean;
}): AgentAdapter {
  if (skillPath) {
    const skillName = path.basename(path.dirname(skillPath));
    const skillDir = path.join(workingDirectory, ".skills", skillName);
    fs.mkdirSync(skillDir, { recursive: true });
    fs.copyFileSync(skillPath, path.join(skillDir, "SKILL.md"));
  }

  // Claude Code doesn't auto-discover .skills/ in arbitrary directories.
  // If .skills/ exists but no CLAUDE.md points to it, create one.
  const skillsDir = path.join(workingDirectory, ".skills");
  const claudeMdPath = path.join(workingDirectory, "CLAUDE.md");
  if (fs.existsSync(skillsDir) && !fs.existsSync(claudeMdPath)) {
    const skillDirs = fs
      .readdirSync(skillsDir, { withFileTypes: true })
      .filter((d) => d.isDirectory() && fs.existsSync(path.join(skillsDir, d.name, "SKILL.md")));
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
              type: "stdio",
              command: "node",
              args: [mcpServerDistPath],
              env: {
                LANGWATCH_API_KEY: process.env.LANGWATCH_API_KEY!,
              },
            },
          },
        };
        fs.writeFileSync(mcpConfigPath, JSON.stringify(mcpConfig));
      }

      return new Promise<string>((resolve, reject) => {
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

        console.log(
          chalk.blue("Starting claude in:"),
          workingDirectory
        );

        const envVars = cleanEnv
          ? Object.fromEntries(
              Object.entries(process.env).filter(
                ([key]) =>
                  !["LANGWATCH_API_KEY", "OPENAI_API_KEY", "ANTHROPIC_API_KEY"].includes(key)
              )
            )
          : process.env;

        const child = spawn(claudeBin, args, {
          cwd: workingDirectory,
          env: { ...envVars, FORCE_COLOR: "0" },
          stdio: ["ignore", "pipe", "pipe"],
        });

        let output = "";

        child.stdout.on("data", (data: Buffer) => {
          const text = data.toString();
          console.log(chalk.cyan("Claude Code:"), text);
          output += text;
        });

        child.stderr.on("data", (data: Buffer) => {
          console.log(chalk.yellow("Claude Code stderr:"), data.toString());
        });

        child.on("close", (exitCode) => {
          if (exitCode === 0) {
            const messages: any = output
              .split("\n")
              .map((line) => {
                try {
                  return JSON.parse(line.trim());
                } catch {
                  return null;
                }
              })
              .filter(
                (message) => message !== null && "message" in message
              )
              .map((message) => message.message);
            console.log(
              "messages",
              JSON.stringify(messages, undefined, 2)
            );

            resolve(messages);
          } else {
            reject(
              new Error(`Command failed with exit code ${exitCode}`)
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

/**
 * Asserts that the agent actually read the SKILL.md file during execution.
 * Checks the conversation messages for evidence of a Read tool call on
 * a .skills/ directory file or explicit SKILL.md content references.
 */
export function assertSkillWasRead(
  state: ScenarioExecutionStateLike,
  skillName: string
): void {
  const allContent = state.messages
    .map((m) =>
      typeof m.content === "string" ? m.content : JSON.stringify(m.content)
    )
    .join("\n");

  const hasSkillRead =
    allContent.includes("SKILL.md") ||
    allContent.includes(`.skills/${skillName}`) ||
    allContent.includes(`skills/${skillName}`);

  if (!hasSkillRead) {
    throw new Error(
      `Expected agent to read the ${skillName} SKILL.md file, but found no evidence ` +
        `of reading .skills/${skillName}/SKILL.md in the conversation. ` +
        `The agent may have ignored the skill and hallucinated instructions.`
    );
  }
}

/**
 * Fixes Anthropic tool use format in message state so it is compatible
 * with the Vercel AI SDK judge agent.
 *
 * Anthropic returns tool_use content blocks that the Vercel AI SDK does
 * not understand. This converts non-text blocks to text blocks containing
 * the JSON representation.
 */
export function toolCallFix(state: ScenarioExecutionStateLike): void {
  state.messages.forEach((message) => {
    if (Array.isArray(message.content)) {
      message.content.forEach((content, index) => {
        if (content.type !== "text") {
          (message.content as any)[index] = {
            type: "text",
            text: JSON.stringify(content),
          };
        }
      });
    }
  });
}
