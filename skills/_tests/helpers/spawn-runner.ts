import { spawn } from "child_process";
import chalk from "chalk";

const API_KEY_ENV_VARS = [
  "LANGWATCH_API_KEY",
  "OPENAI_API_KEY",
  "ANTHROPIC_API_KEY",
];

/**
 * Strips API key environment variables from the current process env.
 *
 * Used when `cleanEnv` is set so that the spawned assistant process
 * cannot accidentally use API keys during testing.
 */
export function stripApiKeys(): NodeJS.ProcessEnv {
  return Object.fromEntries(
    Object.entries(process.env).filter(
      ([key]) => !API_KEY_ENV_VARS.includes(key)
    )
  );
}

/**
 * Parameters for spawning an assistant CLI process.
 */
export interface SpawnRunnerParams {
  /** Path to the binary to spawn. */
  binary: string;
  /** Arguments to pass to the binary. */
  args: string[];
  /** Working directory for the spawned process. */
  workingDirectory: string;
  /** When true, strips API keys from the process environment. */
  cleanEnv?: boolean;
  /** Human-readable label for console output (e.g., "Claude Code", "Codex"). */
  label: string;
  /** Parses the raw stdout output into an array of messages. */
  parseOutput: (output: string) => unknown[];
}

/**
 * Spawns an assistant CLI process and returns parsed output.
 *
 * Encapsulates the common pattern shared by all runners: environment
 * filtering, child_process.spawn, stdout/stderr logging, exit code
 * handling, and output parsing via a runner-specific `parseOutput`
 * function.
 */
export function spawnRunner({
  binary,
  args,
  workingDirectory,
  cleanEnv,
  label,
  parseOutput,
}: SpawnRunnerParams): Promise<unknown[]> {
  return new Promise<unknown[]>((resolve, reject) => {
    console.log(chalk.blue(`Starting ${label} in:`), workingDirectory);

    const envVars = cleanEnv ? stripApiKeys() : process.env;

    const child = spawn(binary, args, {
      cwd: workingDirectory,
      env: { ...envVars, FORCE_COLOR: "0" },
      stdio: ["ignore", "pipe", "pipe"],
    });

    let output = "";

    child.stdout.on("data", (data: Buffer) => {
      const text = data.toString();
      console.log(chalk.cyan(`${label}:`), text);
      output += text;
    });

    child.stderr.on("data", (data: Buffer) => {
      console.log(chalk.yellow(`${label} stderr:`), data.toString());
    });

    child.on("close", (exitCode) => {
      if (exitCode === 0) {
        const messages = parseOutput(output);
        console.log("messages", JSON.stringify(messages, undefined, 2));
        resolve(messages);
      } else {
        reject(
          new Error(`${label} command failed with exit code ${exitCode}`)
        );
      }
    });

    child.on("error", (err) => {
      reject(err);
    });
  });
}
