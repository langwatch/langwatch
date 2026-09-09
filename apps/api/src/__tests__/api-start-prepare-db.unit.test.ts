import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const API_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const REPO_ROOT = path.resolve(API_DIR, "../..");

const scripts: Record<string, string> = JSON.parse(
  readFileSync(path.join(API_DIR, "package.json"), "utf-8"),
).scripts;

/**
 * Runs one of apps/api's own scripts for real, with `pnpm` and `node` replaced
 * by stubs that record what they were asked to do. The stub `pnpm` dispatches
 * `-s run <script>` back through apps/api's package.json, so the chain under
 * test is the shell the developer and the image actually run — not a string
 * this test re-derives. The stub `pnpm` reaches the real Node by its absolute
 * path, since the stub `node` shadows the name on PATH.
 */
function runScript({ script, failOn }: { script: string; failOn?: string }): {
  calls: string[];
  status: number;
} {
  const stubDir = mkdtempSync(path.join(tmpdir(), "api-prepare-db-"));
  const log = path.join(stubDir, "calls.log");

  writeFileSync(
    path.join(stubDir, "pnpm"),
    [
      "#!/bin/sh",
      `echo "pnpm $*" >> "${log}"`,
      // `pnpm -s run <name>` re-enters this package's own scripts.
      'if [ "$1" = "-s" ] && [ "$2" = "run" ]; then',
      `  body=$(${process.execPath} -e 'process.stdout.write(JSON.parse(require("fs").readFileSync(process.argv[1],"utf-8")).scripts[process.argv[2]])' "${path.join(API_DIR, "package.json")}" "$3")`,
      '  exec sh -c "$body"',
      "fi",
      failOn ? `case "$*" in *${failOn}*) exit 1 ;; esac` : "",
      "exit 0",
    ].join("\n"),
    { mode: 0o755 },
  );
  writeFileSync(path.join(stubDir, "node"), `#!/bin/sh\necho "node $*" >> "${log}"\nexit 0\n`, {
    mode: 0o755,
  });
  chmodSync(path.join(stubDir, "pnpm"), 0o755);
  chmodSync(path.join(stubDir, "node"), 0o755);
  writeFileSync(log, "");

  let status = 0;
  try {
    execFileSync("sh", ["-c", scripts[script]!], {
      cwd: API_DIR,
      env: { ...process.env, PATH: `${stubDir}:${process.env.PATH ?? ""}` },
      stdio: "ignore",
    });
  } catch (error) {
    status = (error as { status?: number }).status ?? 1;
  }

  return {
    calls: readFileSync(log, "utf-8").split("\n").filter(Boolean),
    status,
  };
}

describe("given the API process start path", () => {
  describe("when the process is started with pending migrations", () => {
    /** @scenario "The API process applies pending schema migrations before it serves" */
    it("applies both schemas and provisions LangWatchQL before the entry point runs", () => {
      const { calls, status } = runScript({ script: "start" });

      expect(status).toBe(0);
      // One invocation, three names: one process resolves the secrets and
      // parses the config for all three steps. See specs/setup/
      // boot-sequence.feature.
      const tasks = calls.filter((call) => call.includes(" task "));
      expect(tasks).toHaveLength(1);
      expect(tasks[0]!.split(" task ")[1]).toBe("prisma-migrate clickhouse-migrate lwql-provision");

      const entryPoint = calls.findIndex((call) => call.includes("api.entrypoint.ts"));
      expect(entryPoint, "the entry point must run").toBeGreaterThan(-1);
      expect(calls.indexOf(tasks.at(-1)!)).toBeLessThan(entryPoint);
    });

    /** @scenario "The development start path leaves preparation to the stack" */
    it("does not migrate from the development start path", () => {
      const { calls, status } = runScript({ script: "dev" });

      expect(status).toBe(0);
      expect(calls.filter((call) => call.includes(" task "))).toEqual([]);
      expect(calls.some((call) => call.includes("api.entrypoint.ts"))).toBe(true);
    });
  });

  describe("when a migration step fails", () => {
    /** @scenario "A failed migration stops the boot instead of serving" */
    it("stops before the remaining steps and never reaches the entry point", () => {
      const { calls, status } = runScript({ script: "start", failOn: "prisma-migrate" });

      expect(status).not.toBe(0);
      expect(calls.filter((call) => call.includes(" task "))).toHaveLength(1);
      expect(calls.some((call) => call.includes("api.entrypoint.ts"))).toBe(false);
    });
  });

  describe("when a deploy migrates elsewhere", () => {
    /** @scenario "An operator can skip a migration step that a deploy already applied" */
    it("leaves each step its own opt-out", () => {
      // The knobs are the monolith's, unchanged, and each is honoured by the
      // task itself (packages/clickhouse-client, modules/analytics,
      // apps/tasks) rather than by this shell chain — which is why the chain
      // names no condition of its own.
      expect(
        readFileSync(path.join(REPO_ROOT, "apps/tasks/src/tasks/prisma-migrate.task.ts"), "utf-8"),
      ).toContain("SKIP_PRISMA_MIGRATE");
      expect(
        readFileSync(
          path.join(REPO_ROOT, "packages/clickhouse-client/src/tasks/clickhouse-migrate.task.ts"),
          "utf-8",
        ),
      ).toContain("SKIP_CLICKHOUSE_MIGRATE");
      expect(
        readFileSync(path.join(REPO_ROOT, "apps/tasks/src/tasks.catalogue.ts"), "utf-8"),
      ).toContain("SKIP_LWQL_PROVISION");
    });
  });

  describe("when the other two applications start", () => {
    /** @scenario "The worker and the browser application never migrate" */
    it("gives the stack exactly one migrator", () => {
      for (const app of ["apps/worker", "apps/ui"]) {
        const other: Record<string, string> = JSON.parse(
          readFileSync(path.join(REPO_ROOT, app, "package.json"), "utf-8"),
        ).scripts;
        for (const name of ["start", "dev"]) {
          expect(other[name] ?? "", `${app} ${name}`).not.toMatch(
            /prisma-migrate|clickhouse-migrate|lwql-provision|start:prepare:db/,
          );
        }
      }
    });
  });

  describe("when the image starts a container", () => {
    /** @scenario "The image migrates once, through the same script" */
    it("boots through the API's own start path and writes the steps nowhere else", () => {
      const dockerfile = readFileSync(path.join(REPO_ROOT, "infra/docker/Dockerfile"), "utf-8");
      const cmd = /^CMD .*$/m.exec(dockerfile)?.[0] ?? "";

      expect(cmd).toContain("/app/apps/api");
      expect(cmd).toContain("run start");
      expect(cmd).not.toMatch(/prisma-migrate|clickhouse-migrate|lwql-provision/);
    });
  });
});
