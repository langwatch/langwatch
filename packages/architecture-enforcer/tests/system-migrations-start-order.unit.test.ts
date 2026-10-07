import { readFileSync } from "node:fs";

import { describe, expect, it } from "vitest";

/**
 * The api and the worker never migrate: production `start` runs only the entry point, whose upgrade
 * gate refuses until the ledger is current. The api's preparation script runs the upgrade, then
 * the system-migrations pass (specs/upgrade/entry-points.feature).
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

      it("runs only the entry point", () => {
        expect(scripts.start).toMatch(/^node --experimental-transform-types .*src\/main\.ts$/);
      });
    });
  }

  describe("when the api's preparation script runs", () => {
    const scripts = read("../../../apps/api/package.json");

    it("runs the system-migrations pass after the upgrade", () => {
      expect(scripts.prepare).toBe(
        "cd ../tasks && pnpm --silent task upgrade && pnpm --silent task system-migrations-pass",
      );
    });
  });
});
