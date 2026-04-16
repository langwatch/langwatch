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

const cliDistPath = path.resolve(
  __dirname,
  "../../../typescript-sdk/dist/cli/index.js"
);

/**
 * Sets up a local `langwatch` CLI wrapper in the temp folder's bin/ directory.
 * Always called from createClaudeCodeAgent so the spawned Claude Code session
 * sees the locally-built CLI (with `docs`, `scenario-docs`, etc.) on PATH
 * instead of any globally-installed npm version. Skill scenario tests rely on
 * the new CLI commands being available — this is non-optional.
 */
export function setupLocalCli(workingDirectory: string): void {
  if (!fs.existsSync(cliDistPath)) {
    throw new Error(
      `Local langwatch CLI not built at ${cliDistPath}. ` +
        `Run \`pnpm build\` inside typescript-sdk/ before running scenario tests.`
    );
  }

  const binDir = path.join(workingDirectory, "bin");
  fs.mkdirSync(binDir, { recursive: true });

  const wrapperScript = `#!/usr/bin/env bash
exec node "${cliDistPath}" "$@"
`;
  const wrapperPath = path.join(binDir, "langwatch");
  fs.writeFileSync(wrapperPath, wrapperScript, { mode: 0o755 });
}

/**
 * Creates a Claude Code agent adapter for use with @langwatch/scenario.
 *
 * Spawns Claude Code via child_process.spawn. Skills are CLI-only — the locally
 * built `langwatch` CLI is always wired onto PATH so the agent can use
 * `langwatch docs`, `langwatch scenario-docs`, and every platform command.
 * No MCP server is configured; skills must work end-to-end through the CLI.
 *
 * @param workingDirectory - The directory to run Claude Code in
 * @param skillPath - Optional path to a SKILL.md to copy into the working directory
 * @param cleanEnv - When true, strips LANGWATCH_API_KEY, OPENAI_API_KEY, and
 *   ANTHROPIC_API_KEY from the spawned process environment. Use this to test
 *   cold-start flows where the agent must discover keys from .env files.
 */
export function createClaudeCodeAgent({
  workingDirectory,
  skillPath,
  cleanEnv,
}: {
  workingDirectory: string;
  skillPath?: string;
  cleanEnv?: boolean;
}): AgentAdapter {
  setupLocalCli(workingDirectory);
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
      // Render each turn as plain text. Anthropic-format messages can have
      // `content` as an array of blocks (text, tool_use, tool_result, image,
      // …). String-interpolating that array yields `[object Object]`, which
      // the next Claude Code session then sees as the previous turn — making
      // multi-turn scenarios appear garbled to the agent. Flatten content
      // blocks down to readable text instead.
      const renderContent = (content: unknown): string => {
        if (typeof content === "string") return content;
        if (!Array.isArray(content)) {
          try { return JSON.stringify(content); } catch { return String(content); }
        }
        return content
          .map((block: any) => {
            if (block == null) return "";
            if (typeof block === "string") return block;
            switch (block.type) {
              case "text":
                return block.text ?? "";
              case "tool_use": {
                const input = block.input != null
                  ? JSON.stringify(block.input)
                  : "";
                return `[tool_use ${block.name ?? "?"}(${input})]`;
              }
              case "tool_result": {
                const inner =
                  typeof block.content === "string"
                    ? block.content
                    : Array.isArray(block.content)
                      ? renderContent(block.content)
                      : JSON.stringify(block.content ?? "");
                return `[tool_result] ${inner}`;
              }
              case "image":
                return "[image omitted]";
              default:
                try { return JSON.stringify(block); } catch { return String(block); }
            }
          })
          .filter(Boolean)
          .join("\n");
      };

      const formattedMessages = state.messages
        .map((message) => `${message.role}: ${renderContent(message.content)}`)
        .join("\n\n");

      return new Promise<string>((resolve, reject) => {
        const claudeBin =
          process.env.CLAUDE_BIN ||
          execSync("which claude", { encoding: "utf8" }).trim();

        const args = [
          "--output-format",
          "stream-json",
          "-p",
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

        // Prepend the local bin/ wrapper (created by setupLocalCli) so Claude
        // uses the locally-built `langwatch` CLI with the latest commands.
        const localBinDir = path.join(workingDirectory, "bin");
        const pathPrefix = `${localBinDir}:${envVars.PATH ?? ""}`;

        const child = spawn(claudeBin, args, {
          cwd: workingDirectory,
          env: { ...envVars, FORCE_COLOR: "0", PATH: pathPrefix },
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
