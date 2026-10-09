import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

/** The image's tasks app, where `pnpm task upgrade` runs (rethink 6.9). */
export const TASKS_APP_DIRECTORY = fileURLToPath(
  new URL("../../../../apps/tasks/", import.meta.url),
);

/** How many of the run's last lines the upgrade console shows (in-app-upgrade.feature). */
export const UPGRADE_LOG_TAIL_LINES = 50;

/** Runs one `upgrade`: its exit code (a launch failure answers 1) and its last lines of output. */
export type FirstInstallUpgrade = () => Promise<
  Readonly<{ exitCode: number; logTail: readonly string[] }>
>;

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
      child.once("error", () => resolve({ exitCode: 1, logTail }));
      child.once("close", (code) => resolve({ exitCode: code ?? 1, logTail }));
    });
}
