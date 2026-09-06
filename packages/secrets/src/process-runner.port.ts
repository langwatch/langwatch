/** What one child process answered. */
export type ProcessResult = Readonly<{
  code: number;
  stdout: string;
  stderr: string;
}>;

/**
 * Running a command. The 1Password adapter shells out to the `op` CLI through
 * this port, so a test injects a fake instead of requiring the binary.
 */
export abstract class ProcessRunnerPort {
  abstract run({
    command,
    args,
    input,
  }: {
    command: string;
    args: readonly string[];
    input?: string;
  }): Promise<ProcessResult>;
}
