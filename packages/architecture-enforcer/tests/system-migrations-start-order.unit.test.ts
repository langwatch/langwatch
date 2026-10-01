import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * System migrations must complete before a process serves traffic or
 * consumes jobs. Both the API and worker gate production `start` on the
 * tasks app's preflight chain, naming system-migrations AFTER schema migrations.
 */
describe("system migration start ordering", () => {
  const read = (rel: string): { start: string; prepare: string } => {
    const pkg = JSON.parse(readFileSync(new URL(rel, import.meta.url), "utf8")) as {
      scripts: Record<string, string>;
    };
    return {
      start: pkg.scripts.start ?? "",
      prepare: pkg.scripts["start:prepare:db"] ?? "",
    };
  };

  for (const app of ["api", "worker"] as const) {
    describe(`when the ${app} process starts in production`, () => {
      const scripts = read(`../../../apps/${app}/package.json`);

      it("runs the preflight chain before the entrypoint", () => {
        expect(scripts.start).toMatch(/start:prepare:db.*&&/);
      });

      it("runs the system-migrations pass after the schema migrations", () => {
        const prisma = scripts.prepare.indexOf("prisma-migrate");
        const clickhouse = scripts.prepare.indexOf("clickhouse-migrate");
        const pass = scripts.prepare.indexOf("system-migrations-pass");
        expect(prisma).toBeGreaterThan(-1);
        expect(clickhouse).toBeGreaterThan(-1);
        expect(pass).toBeGreaterThan(prisma);
        expect(pass).toBeGreaterThan(clickhouse);
      });
    });
  }
});
