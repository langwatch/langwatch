import {
  type AgentAdapter,
  AgentRole,
  type ScenarioExecutionStateLike,
} from "@langwatch/scenario";
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

interface SkillSource {
  /** Absolute path to the SKILL.md file. */
  skillPath: string;
  /** Absolute path to the _shared/ directory to copy alongside the skill. */
  sharedDir?: string;
  /** Absolute path to a references/ directory to copy alongside the skill. */
  referencesDir?: string;
}

/**
 * Copies SKILL.md, _shared/, and references/ into the working directory's
 * `.skills/<skillName>/` folder so Claude Code auto-discovers the skill.
 */
function copySkillToWorkDir(
  workingDirectory: string,
  skill: SkillSource
): void {
  const skillName = path.basename(path.dirname(skill.skillPath));
  const skillDir = path.join(workingDirectory, ".skills", skillName);
  fs.mkdirSync(skillDir, { recursive: true });
  fs.copyFileSync(skill.skillPath, path.join(skillDir, "SKILL.md"));

  if (skill.sharedDir && fs.existsSync(skill.sharedDir)) {
    const destShared = path.join(skillDir, "_shared");
    fs.mkdirSync(destShared, { recursive: true });
    copyDirRecursive(skill.sharedDir, destShared);
  }

  if (skill.referencesDir && fs.existsSync(skill.referencesDir)) {
    const destRefs = path.join(skillDir, "references");
    fs.mkdirSync(destRefs, { recursive: true });
    copyDirRecursive(skill.referencesDir, destRefs);
  }
}

/**
 * Recursively copies the contents of `src` into `dest`.
 * Both directories must already exist.
 */
function copyDirRecursive(src: string, dest: string): void {
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const srcPath = path.join(src, entry.name);
    const destPath = path.join(dest, entry.name);
    if (entry.isDirectory()) {
      fs.mkdirSync(destPath, { recursive: true });
      copyDirRecursive(srcPath, destPath);
    } else {
      fs.copyFileSync(srcPath, destPath);
    }
  }
}

/**
 * Creates a Claude Code agent adapter for use with @langwatch/scenario.
 *
 * Spawns Claude Code via child_process.spawn with MCP config pointing to the
 * LangWatch MCP server. Copies SKILL.md, _shared/, and references/ into a
 * `.skills/` directory in the working dir so Claude Code auto-discovers them.
 */
export function createClaudeCodeAgent({
  workingDirectory,
  skill,
}: {
  workingDirectory: string;
  skill?: SkillSource;
}): AgentAdapter {
  if (skill) {
    copySkillToWorkDir(workingDirectory, skill);
  }

  return {
    role: AgentRole.AGENT,
    call: async (state) => {
      const formattedMessages = state.messages
        .map((message) => `${message.role}: ${message.content}`)
        .join("\n\n");

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

      const mcpConfigPath = path.join(workingDirectory, ".mcp-test-config.json");
      fs.writeFileSync(mcpConfigPath, JSON.stringify(mcpConfig));

      return new Promise<string>((resolve, reject) => {
        const claudeBin =
          process.env.CLAUDE_BIN ||
          execSync("which claude", { encoding: "utf8" }).trim();

        const args = [
          "--output-format",
          "stream-json",
          "-p",
          "--mcp-config",
          mcpConfigPath,
          "--dangerously-skip-permissions",
          "--verbose",
          formattedMessages,
        ];

        console.log(chalk.blue("Starting claude in:"), workingDirectory);

        const child = spawn(claudeBin, args, {
          cwd: workingDirectory,
          env: { ...process.env, FORCE_COLOR: "0" },
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
          // Clean up the temp MCP config
          try {
            fs.unlinkSync(mcpConfigPath);
          } catch {
            // ignore cleanup errors
          }

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
              chalk.green("Claude Code finished."),
              `${messages.length} messages parsed.`
            );

            resolve(messages);
          } else {
            reject(
              new Error(`Claude Code exited with code ${exitCode}`)
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
