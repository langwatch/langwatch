import { execSync, spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";

const CLI_PATH = path.join(__dirname, "../../../../dist/cli/index.js");

export interface CliResult {
  success: boolean;
  output: string;
  exitCode?: number;
}

/**
 * Handles CLI command execution with integrated logging.
 *
 * Responsibilities:
 * - Execute CLI commands synchronously and asynchronously
 * - Handle interactive CLI commands with input simulation
 * - Log all CLI interactions to replicate terminal experience
 * - Manage process lifecycle and timeouts
 */
export class CliRunner {
  private logPath: string;

  constructor(
    private readonly config: {
      cwd: string;
      timeout?: number;
    },
  ) {
    const logFileName = "cli-test-run.log";
    this.logPath = path.join(config.cwd, logFileName);
    this.log("=== CLI Runner initialized ===");
    // process.chdir(config.testDir);
  }

  /**
   * Logs a message with timestamp to the log file.
   */
  private log(message: string): void {
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] ${message}\n`;
    fs.appendFileSync(this.logPath, logEntry);
  }

  /**
   * Runs a CLI command synchronously in the test directory.
   * @param command CLI command string (e.g., "prompt sync")
   * @returns CliResult with success status and output
   */
  run(command: string): CliResult {
    this.log(`$ ${command}`);

    try {
      const result = execSync(`node ${CLI_PATH} ${command}`, {
        cwd: this.config.cwd,
        encoding: "utf8",
        stdio: "pipe",
      });

      this.log(result);
      return { success: true, output: result };
    } catch (error: any) {
      console.error(error);
      const output = error.stdout ?? error.stderr ?? "";
      this.log(`ERROR (exit ${error.status}): ${output}`);

      return {
        success: false,
        output,
        exitCode: error.status,
      };
    }
  }

  /**
   * Runs a CLI command with interactive input simulation.
   * @param command CLI command string
   * @param inputs Array of input strings to send to stdin
   * @param timeout Optional timeout in milliseconds (default: 10000)
   * @returns Promise<CliResult>
   */
  runInteractive(
    command: string,
    inputs: string[] = [],
    timeout?: number,
  ): Promise<CliResult> {
    const actualTimeout = timeout ?? this.config.timeout ?? 10000;

    this.log(`$ ${command} (interactive with inputs: [${inputs.join(", ")}])`);

    return new Promise<CliResult>((resolve) => {
      const child = spawn("node", [CLI_PATH, ...command.split(" ")], {
        cwd: this.config.cwd,
        stdio: ["pipe", "pipe", "pipe"],
      });

      let output = "";
      let errorOutput = "";
      let resolved = false;

      const resolveOnce = (result: CliResult) => {
        if (!resolved) {
          resolved = true;
          const fullOutput = result.output;
          if (result.success) {
            this.log(fullOutput);
          } else {
            this.log(`ERROR (exit ${result.exitCode}): ${fullOutput}`);
          }
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
        resolveOnce({
          success: code === 0,
          output: fullOutput,
          exitCode: code ?? undefined,
        });
      });

      child.on("error", (error) => {
        resolveOnce({
          success: false,
          output: output + errorOutput + error.message,
          exitCode: 1,
        });
      });

      // Send inputs to stdin with timing
      if (inputs.length > 0) {
        setTimeout(() => {
          inputs.forEach((input, index) => {
            setTimeout(() => {
              if (!child.killed) {
                this.log(`> ${input}`);
                child.stdin.write(input + "\n");
              }
            }, index * 100);
          });

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
        child.stdin.end();
      }

      // Timeout handling
      setTimeout(() => {
        if (!resolved) {
          child.kill();
          resolveOnce({
            success: false,
            output: output + errorOutput + "\n[Process timed out]",
            exitCode: 1,
          });
        }
      }, actualTimeout);
    });
  }

  /**
   * Gets the path to the log file.
   */
  getLogPath(): string {
    return this.logPath;
  }
}
