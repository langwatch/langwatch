import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { resolveTasksConfig } from "../platform/config/tasks.config.ts";

const TASKS_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const REPO_ROOT = path.resolve(TASKS_DIR, "../..");

const read = (relative: string): string => readFileSync(path.join(REPO_ROOT, relative), "utf-8");

const scripts = (relative: string): Record<string, string> =>
  JSON.parse(read(relative)).scripts ?? {};

/** The one invocation the whole preparation step is, wherever it is written. */
const PREPARE_TASKS = "prisma-migrate clickhouse-migrate lwql-provision";

describe("given the preparation step", () => {
  describe("when it is written as a script", () => {
    /** @scenario "Several task names in one invocation run in one process" */
    it("names the three tasks in one invocation, not one process each", () => {
      const api = scripts("apps/api/package.json")["start:prepare:db"] ?? "";
      const root = scripts("package.json")["start:prepare:db"] ?? "";

      expect(api).toContain(PREPARE_TASKS);
      expect(root).toContain(PREPARE_TASKS);
      // Each name written once means one invocation, and one invocation means
      // one Node process: three chained ones are the boot this change exists
      // to stop repeating.
      for (const task of PREPARE_TASKS.split(" ")) {
        expect(api.match(new RegExp(task, "g")), `${task} in apps/api`).toHaveLength(1);
        expect(root.match(new RegExp(task, "g")), `${task} in the workspace root`).toHaveLength(1);
      }
    });
  });

  describe("when the local stack launcher starts a stack", () => {
    /** @scenario "The local stack launcher migrates once, before the lanes" */
    it("runs the step once, before the first lane", () => {
      const launcher = read("dev/scripts/dev-stack.sh");

      const prepare = launcher.indexOf("run start:prepare:db");
      const firstLane = launcher.indexOf("add_lane ");
      expect(prepare, "the launcher must prepare the databases").toBeGreaterThan(-1);
      expect(prepare).toBeLessThan(firstLane);
      expect(launcher.match(/run start:prepare:db/g)).toHaveLength(1);
    });
  });

  describe("when a supervised lane reloads or crashes", () => {
    /** @scenario "A code change reloads a lane without migrating again" */
    it("keeps the preparation step out of every lane's own dev command", () => {
      for (const manifest of [
        "apps/api/package.json",
        "apps/worker/package.json",
        "apps/ui/package.json",
        "tools/dev-runtime/package.json",
      ]) {
        expect(scripts(manifest).dev ?? "", `${manifest} dev`).not.toMatch(
          /start:prepare:db|prisma-migrate|clickhouse-migrate|lwql-provision/,
        );
      }
    });

    /** @scenario "A crash restart does not migrate again" */
    it("gives the restarted lane nothing to run but the process it supervises", () => {
      const devRuntime = scripts("tools/dev-runtime/package.json").dev ?? "";

      expect(devRuntime).toContain("dev-supervisor.mjs");
      expect(devRuntime).toContain("backend.entrypoint.ts");
      expect(devRuntime.split("&&").length, "one command, not a chain").toBeLessThan(3);
    });
  });

  describe("when haven brings a stack up", () => {
    /** @scenario "The orchestrator prepares the worktree through the same step" */
    it("prepares through the same one script the launcher runs", () => {
      const orchestrator = read("tools/thuishaven/app/orchestrator.go");
      const shell = /const prepareDBShell = "([^"]+)"/.exec(orchestrator)?.[1] ?? "";

      expect(shell).toContain("start:prepare:db");
      expect(shell).not.toContain("&&");
    });
  });

  describe("when the production start path runs", () => {
    /** @scenario "The API listens only after preparation succeeded" */
    it("prepares first and only then reaches the entry point", () => {
      const start = scripts("apps/api/package.json").start ?? "";

      expect(start.indexOf("start:prepare:db")).toBeLessThan(start.indexOf("api.entrypoint.ts"));
      expect(start).toContain("&&");
    });
  });
});

describe("given a configuration the runner cannot accept", () => {
  describe("when the process resolves it", () => {
    /** @scenario "Configuration is validated before any migration runs" */
    it("refuses before any task runs, and names what is wrong", () => {
      expect(() => resolveTasksConfig({ DATABASE_URL: "" })).toThrowError(/DATABASE_URL/);
    });
  });
});
