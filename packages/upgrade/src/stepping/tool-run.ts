import { spawn } from "node:child_process";

/** What one run of a migration tool left behind: its exit code and its combined output. */
export interface ToolRun {
  exitCode: number | null;
  output: string;
  aborted: boolean;
}

/** Runs a migration tool to completion, collecting its output; never throws on a non-zero exit. */
export function runTool({
  command,
  args,
  cwd,
  environment,
  signal,
}: {
  command: string;
  args: readonly string[];
  cwd?: string;
  environment: Readonly<Record<string, string | undefined>>;
  signal?: AbortSignal;
}): Promise<ToolRun> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    const child = spawn(command, [...args], { cwd, env: { ...environment }, signal });
    child.stdout.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.stderr.on("data", (chunk: Buffer) => chunks.push(chunk));
    child.on("error", (error) => {
      const aborted = error.name === "AbortError";
      resolve({ exitCode: null, output: aborted ? "aborted" : error.message, aborted });
    });
    child.on("close", (exitCode) => {
      resolve({ exitCode, output: Buffer.concat(chunks).toString("utf8"), aborted: false });
    });
  });
}
