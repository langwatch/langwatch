import { readFileSync } from "node:fs";

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
    task: 'cd /app/apps/tasks && exec pnpm --silent task "$@"',
  };

  for (const [name, target] of Object.entries(mapped)) {
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
});
