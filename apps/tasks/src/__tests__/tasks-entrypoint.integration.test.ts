import { execFile } from "node:child_process";
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
    }, 30_000);
  });
});
