import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

import { UPGRADE_LOG_TAIL_LINES } from "../runner/run-log.ts";
import type { UpgradeOutcomeCode } from "../runner/upgrade-outcome.ts";

/** The image's tasks app, where `pnpm task upgrade` runs (rethink 6.9). */
export const TASKS_APP_DIRECTORY = fileURLToPath(
  new URL("../../../../apps/tasks/", import.meta.url),
);

/** One upgrade run as the worker's gate sees it: the runner's outcome and its last lines. */
export type UpgradeRunResult = Readonly<{ code: UpgradeOutcomeCode; logTail: readonly string[] }>;

/** Runs one `upgrade`, in a child process or in this one. */
export type FirstInstallUpgrade = () => Promise<UpgradeRunResult>;

/** A child's exit code as the runner's outcome: 0 done, 3 lease not acquired, else failed. */
export function outcomeOfExitCode(exitCode: number): UpgradeOutcomeCode {
  if (exitCode === 0) return "done";
  return exitCode === 3 ? "lease_not_acquired" : "failed";
}

/**
 * Q10: on a Helm first install the api's first boot runs `upgrade` once, as the pre-roll Job would,
 * in its own process with this process's environment and output (held question S3-FIRST-INSTALL),
 * keeping the last lines for the upgrade console.
 */
export function spawnFirstInstallUpgrade({
  cwd = TASKS_APP_DIRECTORY,
  command = "pnpm",
  args = ["--silent", "task", "upgrade"],
}: { cwd?: string; command?: string; args?: readonly string[] } = {}): FirstInstallUpgrade {
  return () =>
    new Promise((resolve) => {
      const logTail: string[] = [];
      const tee = (out: NodeJS.WritableStream) => (chunk: Buffer) => {
        out.write(chunk);
        // ponytail: a line split across two chunks shows as two lines in the console.
        logTail.push(
          ...chunk
            .toString("utf8")
            .split("\n")
            .filter((line) => line !== ""),
        );
        logTail.splice(0, Math.max(0, logTail.length - UPGRADE_LOG_TAIL_LINES));
      };
      const child = spawn(command, [...args], { cwd, stdio: ["inherit", "pipe", "pipe"] });
      child.stdout.on("data", tee(process.stdout));
      child.stderr.on("data", tee(process.stderr));
      child.once("error", () => resolve({ code: "failed", logTail }));
      child.once("close", (code) => resolve({ code: outcomeOfExitCode(code ?? 1), logTail }));
    });
}
