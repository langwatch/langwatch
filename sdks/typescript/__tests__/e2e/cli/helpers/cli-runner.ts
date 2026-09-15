import { execSync, spawn } from "child_process";
import * as fs from "fs";
import * as path from "path";

const CLI_PATH = path.join(__dirname, "../../../../dist/cli/index.js");

/** The errors a write raises when the reader on the pipe is already gone. */
const CLOSED_PIPE_CODES = new Set(["EPIPE", "ERR_STREAM_DESTROYED"]);

export interface CliResult {
  success: boolean;
  output: string;
  exitCode?: number;
}

/**
 * Handles CLI command execution with integrated logging.
 */
export class CliRunner {
  private logPath: string;

  constructor(
    private readonly config: {
      cwd: string;
      timeout?: number;
      /**
       * Environment for the spawned CLI, laid over this process's own. A key
       * whose value is `undefined` is removed, which is how a test spawns the
       * CLI with no credential at all.
       */
      env?: Record<string, string | undefined>;
    },
  ) {
    const logFileName = "cli-test-run.log";
    this.logPath = path.join(config.cwd, logFileName);
    this.log("=== CLI Runner initialized ===");
  }

  /**
   * This process's environment with the caller's overlay applied, an
   * `undefined` value meaning the variable is absent from the child.
   */
  private spawnEnv(): NodeJS.ProcessEnv {
    const overlay = this.config.env;
    if (!overlay) return process.env;
    const env: NodeJS.ProcessEnv = { ...process.env };
    for (const [name, value] of Object.entries(overlay)) {
      if (value === undefined) delete env[name];
      else env[name] = value;
    }
    return env;
  }

  /**
   * Logs a message with timestamp to the log file.
   */
  private log(message: string): void {
    const timestamp = new Date().toISOString();
    const logEntry = `[${timestamp}] ${message}\n`;
    try {
      fs.appendFileSync(this.logPath, logEntry);
    } catch (e: unknown) {
      // Silently swallow ENOENT: timers set up for stdin input may fire
      // after afterEach removes testDir. Any other error is real and should propagate.
      if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e;
    }
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
        env: this.spawnEnv(),
      });

      this.log(result);
      return { success: true, output: result };
    } catch (error: any) {
      console.error(error);
      const output = [error.stdout, error.stderr].filter(Boolean).join("");
      this.log(`ERROR (exit ${error.status}): ${output}`);

      return {
        success: false,
        output,
        exitCode: error.status,
      };
    }
  }

  /** Runs a CLI command with interactive input simulation. */
  runInteractive({
    command,
    inputs = [],
    timeout,
  }: {
    command: string;
    inputs?: string[];
    timeout?: number;
  }): Promise<CliResult> {
    const actualTimeout = timeout ?? this.config.timeout ?? 10000;

    this.log(`$ ${command} (interactive with inputs: [${inputs.join(", ")}])`);

    return new Promise<CliResult>((resolve) => {
      const child = spawn("node", [CLI_PATH, ...command.split(" ")], {
        cwd: this.config.cwd,
        stdio: ["pipe", "pipe", "pipe"],
        env: this.spawnEnv(),
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

      // A command that finishes before its scripted inputs run out leaves stdin closed, and
      // `killed` stays false because nothing signalled the child. Writing then raises EPIPE from
      // a timer, outside any test, and vitest reports it as an unhandled error that fails the
      // whole run. Ask the stream whether it can still take a write, and let a pipe that closes
      // mid-write end the input quietly.
      child.stdin.on("error", (error: NodeJS.ErrnoException) => {
        // A pipe that closes between the check and the write is the
        // expected race. Any other error is a real fault, so it joins
        // the output the assertions read.
        if (CLOSED_PIPE_CODES.has(error.code ?? "")) return;
        errorOutput += `stdin error: ${error.message}\n`;
      });
      const canWriteStdin = () => !child.killed && child.stdin.writable && !child.stdin.destroyed;

      // Send inputs to stdin with timing
      if (inputs.length > 0) {
        setTimeout(() => {
          inputs.forEach((input, index) => {
            setTimeout(() => {
              if (canWriteStdin()) {
                this.log(`> ${input}`);
                child.stdin.write(input + "\n");
              }
            }, index * 100);
          });

          setTimeout(
            () => {
              if (canWriteStdin()) {
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
