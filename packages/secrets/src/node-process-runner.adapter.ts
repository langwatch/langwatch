import { spawn } from "node:child_process";
import { ProcessRunnerPort, type ProcessResult } from "./process-runner.port.ts";

/** The real child process. Never constructed in production — see `SecretChain`. */
export class NodeProcessRunner extends ProcessRunnerPort {
  static create(): NodeProcessRunner {
    return new NodeProcessRunner();
  }

  run({
    command,
    args,
    input,
  }: {
    command: string;
    args: readonly string[];
    input?: string;
  }): Promise<ProcessResult> {
    return new Promise((resolve, reject) => {
      const child = spawn(command, [...args], { stdio: ["pipe", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString("utf8")));
      child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString("utf8")));
      child.on("error", reject);
      child.on("close", (code) => resolve({ code: code ?? 0, stdout, stderr }));
      if (input !== undefined) child.stdin.write(input);
      child.stdin.end();
    });
  }
}
