import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";

/** The image's tasks app, where `pnpm task upgrade` runs (rethink 6.9). */
export const TASKS_APP_DIRECTORY = fileURLToPath(
  new URL("../../../../apps/tasks/", import.meta.url),
);

/** Runs one `upgrade` and answers its exit code; a launch failure answers 1. */
export type FirstInstallUpgrade = () => Promise<number>;

/**
 * Q10: on a Helm first install the api's first boot runs `upgrade` once, as the pre-roll Job would,
 * in its own process with this process's environment and output (held question S3-FIRST-INSTALL).
 */
export function spawnFirstInstallUpgrade({
  cwd = TASKS_APP_DIRECTORY,
  command = "pnpm",
  args = ["--silent", "task", "upgrade"],
}: { cwd?: string; command?: string; args?: readonly string[] } = {}): FirstInstallUpgrade {
  return () =>
    new Promise((resolve) => {
      const child = spawn(command, [...args], { cwd, stdio: "inherit" });
      child.once("error", () => resolve(1));
      child.once("exit", (code) => resolve(code ?? 1));
    });
}
