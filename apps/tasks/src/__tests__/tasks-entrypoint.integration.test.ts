import { execFile } from "node:child_process";
import process from "node:process";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

/**
 * Runs the built entrypoint two ways: a bare `pnpm -s task <name>` (the
 * container CMD's own invocation), and the filtered form a laptop uses from
 * the repo root. Both must resolve the same catalogue entry and run the same
 * task — there is exactly one command line, not one per environment.
 */
describe("apps/tasks entrypoint", () => {
  describe("given the webhook-signature-vectors task, which needs no infrastructure", () => {
    /** @scenario "The same command line works from a laptop and from the container CMD" */
    it("runs identically from a laptop-style and a container-style invocation", async () => {
      const laptop = await execFileAsync(
        "pnpm",
        ["--filter", "@langwatch/tasks", "task", "webhook-signature-vectors"],
        { cwd: new URL("../../../..", import.meta.url).pathname },
      );
      const container = await execFileAsync("pnpm", ["-s", "task", "webhook-signature-vectors"], {
        cwd: new URL("../..", import.meta.url).pathname,
      });

      expect(laptop.stdout).toContain("wrote");
      expect(container.stdout).toContain("wrote");
    }, 60_000);
  });

  describe("given an environment carrying a stored-object backend nothing implements", () => {
    /** @scenario "The task process validates its configuration before a migration runs" */
    it("refuses before it builds the catalogue or runs a task", async () => {
      const failure = await execFileAsync("pnpm", ["-s", "task", "webhook-signature-vectors"], {
        cwd: new URL("../..", import.meta.url).pathname,
        env: { ...process.env, STORED_OBJECTS_BACKEND: "gcs" },
      }).catch((error: unknown) => error as { stdout: string; stderr: string; code: number });

      const output = `${failure.stdout ?? ""}${failure.stderr ?? ""}`;
      expect(output).toContain("Invalid tasks configuration");
      expect(output).not.toContain("wrote");
    }, 60_000);
  });
});
