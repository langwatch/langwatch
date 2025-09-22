import scenario, {
  type AgentAdapter,
  AgentRole,
  ScenarioExecutionStateLike,
} from "@langwatch/scenario";
import fs from "fs";
import { execSync } from "child_process";
import { describe, it, expect } from "vitest";
import dotenv from "dotenv";
import os from "os";
import path from "path";
import * as pty from "node-pty";
import chalk from "chalk";
import { anthropic } from "@ai-sdk/anthropic";

dotenv.config();

const claudeCodeAgent = (workingDirectory: string): AgentAdapter => ({
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
            `${__dirname}/../dist/index.js`,
            "--apiKey",
            process.env.LANGWATCH_API_KEY!,
          ],
        },
      },
    };
    fs.writeFileSync(
      `${__dirname}/.mcp-config.json`,
      JSON.stringify(mcpConfig)
    );

    return new Promise<string>((resolve, reject) => {
      const args = [
        "--output-format",
        "stream-json",
        "-p",
        "--mcp-config",
        `${__dirname}/.mcp-config.json`,
        "--dangerously-skip-permissions",
        "--verbose",
        formattedMessages,
      ];

      console.log(chalk.blue("Starting claude in:"), workingDirectory);

      const ptyProcess = pty.spawn(
        `${__dirname}/../node_modules/.bin/claude`,
        args,
        {
          name: "xterm-256color",
          cols: 80,
          rows: 30,
          cwd: workingDirectory,
          env: { ...process.env, FORCE_COLOR: "1" },
        }
      );

      let output = "";

      ptyProcess.onData((data) => {
        console.log(chalk.cyan("Claude Code:"), data);
        output += data;
      });

      ptyProcess.onExit(({ exitCode }) => {
        if (exitCode === 0) {
          console.log("output", output);
          const messages: any = output
            .split("\n")
            .map((line) => {
              try {
                return JSON.parse(line.trim());
              } catch (error) {
                return null;
              }
            })
            .filter((message) => message !== null && "message" in message)
            .map((message) => message.message);
          console.log("messages", JSON.stringify(messages, undefined, 2));

          resolve(messages);
        } else {
          reject(new Error(`Command failed with exit code ${exitCode}`));
        }
      });
    });
  },
});

describe("OpenAI Implementation", () => {
  it("implements LangWatch in an OpenAI bot project", async () => {
    const tempFolder = fs.mkdtempSync(
      path.join(os.tmpdir(), "langwatch-openai-bot-")
    );
    execSync(
      `cp -r tests/fixtures/openai/openai_bot_function_call_input.py ${tempFolder}/main.py`
    );

    const result = await scenario.run({
      name: "OpenAI bot project",
      description: `Implementing code changes in an OpenAI bot project to add LangWatch instrumentation.`,
      agents: [
        claudeCodeAgent(tempFolder),
        scenario.userSimulatorAgent(),
        scenario.judgeAgent({
          model: anthropic("claude-sonnet-4-20250514"),
          criteria: [
            "Agent should edit main.py file",
            "Agent should use the langwatch MCP for checking the documentation",
          ],
        }),
      ],
      script: [
        scenario.user(
          "please instrument my code with langwatch, short and sweet, no need to test the changes"
        ),
        scenario.agent(),
        () => {
          const resultFile = fs.readFileSync(`${tempFolder}/main.py`, "utf8");

          expect(resultFile).toContain("@langwatch.trace(");
          expect(resultFile).toContain("autotrack_openai_calls(client)");
          // TODO: expect(resultFile).toContain('@langwatch.span(type="tool")');
        },
        toolCallFix,
        scenario.judge(),
      ],
    });

    expect(result.success).toBe(true);
  });
});

function toolCallFix(state: ScenarioExecutionStateLike) {
  // Fix for anthropic tool use format, that is not supported by vercel ai for the judge
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
