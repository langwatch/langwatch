import { spawnSync } from "node:child_process";
import { chmodSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

/** The old /app/platform/app start commands keep working (specs/upgrade/entry-points.feature). */
describe("image compatibility start paths", () => {
  const root = new URL("../../../", import.meta.url);
  const { scripts } = JSON.parse(
    readFileSync(new URL("infra/docker/compat/platform-app/package.json", root), "utf8"),
  ) as { scripts: Record<string, string> };

  const mapped: Record<string, string> = {
    start: "cd /app/apps/api && exec pnpm --silent run start",
    "start:app": "cd /app/apps/api && exec pnpm --silent run start",
    "start:workers": "cd /app/apps/worker && exec pnpm --silent run start",
    "start:prepare:db": "cd /app/apps/tasks && exec pnpm --silent task upgrade",
    "prisma:migrate": "cd /app/apps/tasks && exec pnpm --silent task upgrade",
    "clickhouse:migrate": "cd /app/apps/tasks && exec pnpm --silent task upgrade",
    "lwql:provision": "cd /app/apps/tasks && exec pnpm --silent task lwql-provision",
  };

  it("task hands pnpm's appended arguments to the task script", () => {
    expect(scripts.task).toBe("sh /app/platform/app/task.sh");
  });

  for (const [name, target] of Object.entries(mapped)) {
    /** @scenario The old start paths still work with a deprecation warning */
    it(`${name} warns on stderr and runs the new command`, () => {
      expect(scripts[name]).toMatch(/^echo 'langwatch: .* is deprecated; use .*' >&2; /);
      expect(scripts[name]?.endsWith(`; ${target}`)).toBe(true);
    });
  }

  for (const name of ["prisma:seed", "task:backfill-datasets-s3", "task:migrate-object-storage"]) {
    it(`${name} warns and exits non-zero`, () => {
      expect(scripts[name]).toMatch(/>&2; exit 1$/);
    });
  }

  it("is copied into the image at /app/platform/app", () => {
    const dockerfile = readFileSync(new URL("infra/docker/Dockerfile", root), "utf8");
    expect(dockerfile).toContain(
      "COPY infra/docker/compat/platform-app/package.json /app/platform/app/package.json",
    );
  });

  it("copies the task script next to it", () => {
    const dockerfile = readFileSync(new URL("infra/docker/Dockerfile", root), "utf8");
    expect(dockerfile).toContain(
      "COPY infra/docker/compat/platform-app/task.sh /app/platform/app/task.sh",
    );
  });

  describe("given the compat task script", () => {
    const script = new URL("infra/docker/compat/platform-app/task.sh", root).pathname;
    const bin = mkdtempSync(join(tmpdir(), "task-sh-"));
    writeFileSync(join(bin, "pnpm"), '#!/bin/sh\necho "pnpm $* out=${LWQL_RENDER_OUT_DIR:-}"\n');
    chmodSync(join(bin, "pnpm"), 0o755);
    const run = (...args: string[]) =>
      spawnSync("sh", [script, ...args], {
        encoding: "utf8",
        env: { PATH: `${bin}:/usr/bin:/bin`, LANGWATCH_TASKS_DIR: tmpdir() },
      });

    /** @scenario An old task name from the old chart still runs its new task */
    it("turns renderLwqlAccessConfig --out into the env var and the new name", () => {
      const result = run("renderLwqlAccessConfig", "--out", "/render");
      expect(result.status).toBe(0);
      expect(result.stdout.trim()).toBe("pnpm --silent task lwql-render-access-config out=/render");
      expect(result.stderr).toContain("deprecated");
    });

    /** @scenario An old task name from the old chart still runs its new task */
    it("maps the other old names and passes new names through", () => {
      expect(run("clickhouseMigrate").stdout).toContain("task upgrade out=");
      expect(run("upgrade", "status").stdout).toContain("task upgrade status");
    });

    /** @scenario An old task name from the old chart still runs its new task */
    it("exits 1 for an old name with no equivalent", () => {
      const result = run("migrateObjectStorage");
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("no equivalent");
    });
  });
});
