import * as path from "path";
import * as fs from "fs";
import { execSync, spawn } from "child_process";

/**
 * Helper class for CLI E2E tests.
 *
 * Encapsulates common file and CLI operations used in end-to-end tests for the CLI.
 *
 * Responsibilities:
 * - Running CLI commands in a test directory.
 * - Creating and updating prompt files in YAML format.
 * - Creating a prompts config file.
 * - Loading the lock file for prompts.
 * - Logging all operations and outputs to a log file.
 *
 * Usage:
 *   const helpers = new CliHelpers(testDir);
 *   helpers.runCli("prompt init");
 *   helpers.createPromptFile("my-prompt", { ... });
 *   helpers.createConfig({ ... });
 *   const lock = helpers.loadLock();
 */
export class CliHelpers {
  private logPath: string;

  /**
   * @param testDir Absolute path to the test working directory.
   */
  constructor(private readonly config: { testDir: string }) {
    this.logPath = path.join(this.config.testDir, "..", "cli-test-run.log");
    this.log("=== CLI Helper initialized ===");
  }

  private get testDir() {
    return this.config.testDir;
  }

  /**
   * Logs a message with timestamp to the log file.
   * @param message Message to log
   * @param data Optional additional data to log
   */
  private log = (message: string, data?: any) => {
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] ${message}`;
    const dataStr = data ? `\nData: ${JSON.stringify(data, null, 2)}` : "";
    const fullEntry = `${logEntry}${dataStr}\n\n`;

    fs.appendFileSync(this.logPath, fullEntry);
  };

  /**
   * Creates a unique prompt name for the test.
   * @returns Unique prompt name
   */
  createUniquePromptName = () => {
    const name = `test-prompt-${Date.now()}`;
    return name;
  };

  /**
   * Runs a CLI command in the test directory.
   * @param command CLI command string (e.g., "prompt sync")
   * @returns { success: boolean, output: string, exitCode?: number }
   */
  runCli = (command: string) => {
    this.log(`${command}`);

    try {
      const result = execSync(
        `node ../../../../../dist/cli/index.js ${command}`,
        {
          cwd: this.testDir,
          encoding: "utf8",
          stdio: "pipe",
        },
      );

      this.log(result);
      return { success: true, output: result };
    } catch (error: any) {
      const errorResult = {
        success: false,
        output: error.stdout || error.stderr || "",
        exitCode: error.status,
      };

      this.log("CLI command failed", {
        error: error.message,
        result: errorResult,
      });

      return errorResult;
    }
  };

  /**
   * Runs a CLI command with interactive input in the test directory.
   * @param command CLI command string (e.g., "prompt sync")
   * @param inputs Array of input strings to send to stdin
   * @returns { success: boolean, output: string, exitCode?: number }
   */
  runCliInteractive = (command: string, inputs: string[] = []) => {
    this.log(`${command} (interactive with inputs: ${inputs.join(", ")})`);

    return new Promise<{ success: boolean; output: string; exitCode?: number }>(
      (resolve) => {
        const child = spawn(
          "node",
          ["../../../../../dist/cli/index.js", ...command.split(" ")],
          {
            cwd: this.testDir,
            stdio: ["pipe", "pipe", "pipe"],
          },
        );

        let output = "";
        let errorOutput = "";
        let resolved = false;

        const resolveOnce = (result: {
          success: boolean;
          output: string;
          exitCode?: number;
        }) => {
          if (!resolved) {
            resolved = true;
            resolve(result);
          }
        };

        child.stdout.on("data", (data) => {
          output += data.toString();
        });

        child.stderr.on("data", (data) => {
          errorOutput += data.toString();
        });

        child.on("close", (code) => {
          const fullOutput = output + errorOutput;
          this.log(fullOutput);

          const result = {
            success: code === 0,
            output: fullOutput,
            exitCode: code || undefined,
          };

          resolveOnce(result);
        });

        child.on("error", (error) => {
          this.log("Process error", error);
          resolveOnce({
            success: false,
            output: output + errorOutput + error.message,
            exitCode: 1,
          });
        });

        // Send inputs to stdin
        if (inputs.length > 0) {
          // Wait a bit for the process to start and show the prompt
          setTimeout(() => {
            inputs.forEach((input, index) => {
              setTimeout(() => {
                if (!child.killed) {
                  child.stdin.write(input + "\n");
                }
              }, index * 100); // Small delay between inputs
            });

            // Close stdin after sending all inputs
            setTimeout(
              () => {
                if (!child.killed) {
                  child.stdin.end();
                }
              },
              inputs.length * 100 + 1000,
            );
          }, 500);
        } else {
          // If no inputs, close stdin immediately
          child.stdin.end();
        }

        // Add a timeout to prevent hanging
        setTimeout(() => {
          if (!resolved) {
            this.log("Process timeout, killing process");
            child.kill();
            resolveOnce({
              success: false,
              output: output + errorOutput + "\n[Process timed out]",
              exitCode: 1,
            });
          }
        }, 10000); // 10 second timeout
      },
    );
  };

  /**
   * Creates a prompt YAML file in the prompts directory.
   * @param name Name of the prompt (used as filename)
   * @param content Object with model, temperature, systemMessage, userMessage
   * @returns Absolute path to the created file
   */
  createPromptFile = (name: string, content: any) => {
    const promptsDir = path.join(this.testDir, "prompts");
    fs.mkdirSync(promptsDir, { recursive: true });

    const filePath = path.join(promptsDir, `${name}.prompt.yaml`);
    const yaml = `model: ${content.model}
modelParameters:
  temperature: ${content.temperature || 0.7}
messages:
  - role: system
    content: ${content.systemMessage || "You are a helpful assistant."}
  - role: user
    content: ${content.userMessage || "Hello {{name}}"}
`;
    fs.writeFileSync(filePath, yaml);

    return filePath;
  };

  /**
   * Updates an existing prompt YAML file with new values.
   * Only replaces model, temperature, and systemMessage fields.
   * @param name Name of the prompt file (without extension)
   * @param updates Object with model, temperature, systemMessage
   */
  updatePromptFile = (name: string, updates: any) => {
    const filePath = path.join(this.testDir, "prompts", `${name}.prompt.yaml`);
    const content = fs.readFileSync(filePath, "utf8");
    const updated = content
      .replace(/model: .+/, `model: ${updates.model || "gpt-4"}`)
      .replace(/temperature: .+/, `temperature: ${updates.temperature || 0.7}`)
      .replace(
        /content: .+/,
        `content: ${updates.systemMessage || "You are a helpful assistant."}`,
      );
    fs.writeFileSync(filePath, updated);
  };

  /**
   * Get prompt file content
   */
  getPromptFileContent = (name: string) => {
    const filePath = path.join(this.testDir, "prompts", `${name}.prompt.yaml`);
    return fs.readFileSync(filePath, "utf8");
  };

  /**
   * Creates a prompts.json config file in the test directory.
   * @param prompts Record of prompt names to file paths or remote refs
   */
  createConfig = (prompts: Record<string, string>) => {
    fs.writeFileSync(
      path.join(this.testDir, "prompts.json"),
      JSON.stringify({ prompts }, null, 2),
    );
  };

  /**
   * Loads the prompts-lock.json file if it exists.
   * @returns Parsed lock file object, or null if not found.
   */
  loadLock = () => {
    const lockPath = path.join(this.testDir, "prompts-lock.json");
    const result = fs.existsSync(lockPath)
      ? JSON.parse(fs.readFileSync(lockPath, "utf8"))
      : null;
    return result;
  };

  /**
   * Gets the path to the log file for this test run.
   * @returns Absolute path to the log file
   */
  getLogPath = () => {
    return this.logPath;
  };
}
