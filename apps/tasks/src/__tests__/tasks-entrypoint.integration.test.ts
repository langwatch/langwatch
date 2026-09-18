import { execFile } from "node:child_process";
import process from "node:process";
import { promisify } from "node:util";

import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

const environment = {
  ...process.env,
  NODE_ENV: "test",
  DATABASE_URL: "",
  SKIP_PRISMA_MIGRATE: "true",
  LANGWATCH_SECRETS_VAULT: "",
  VITEST: "",
};

describe("apps/tasks entrypoint", () => {
  describe("given a skipped Prisma migration, which needs no infrastructure", () => {
    /** @scenario "The same command line works from a laptop and from the container CMD" */
    it("runs identically from a laptop-style and a container-style invocation", async () => {
      const laptop = await execFileAsync(
        "pnpm",
        ["--filter", "@langwatch/tasks", "task", "prisma-migrate"],
        { cwd: new URL("../../../..", import.meta.url).pathname, env: environment },
      );
      const container = await execFileAsync("pnpm", ["-s", "task", "prisma-migrate"], {
        cwd: new URL("../..", import.meta.url).pathname,
        env: environment,
      });

      expect(laptop.stdout).toContain("skipping Prisma migrations");
      expect(container.stdout).toContain("skipping Prisma migrations");
    }, 60_000);
  });

  describe("given an invalid process environment", () => {
    /** @scenario "The task process validates its configuration before a migration runs" */
    it("refuses before it builds the catalogue or runs a task", async () => {
      const failure = execFileAsync("pnpm", ["-s", "task", "prisma-migrate"], {
        cwd: new URL("../..", import.meta.url).pathname,
        env: { ...environment, NODE_ENV: "invalid" },
      });
      await expect(failure).rejects.toMatchObject({
        code: 1,
        // The one parse refuses naming owner, field and the variable behind it.
        stderr: expect.stringContaining("tasks.nodeEnvironment ← NODE_ENV"),
        stdout: expect.not.stringContaining("skipping Prisma migrations"),
      });
    }, 60_000);
  });
});
