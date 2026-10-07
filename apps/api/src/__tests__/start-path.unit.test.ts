import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

function readFromRoot(relative: string): string {
  return readFileSync(fileURLToPath(new URL(`../../../../${relative}`, import.meta.url)), "utf8");
}

function scriptsOf(app: string): Record<string, string> {
  return JSON.parse(readFromRoot(`apps/${app}/package.json`)).scripts;
}

const scripts = scriptsOf("api");
const MIGRATES =
  /start:prepare:db|prisma-migrate|clickhouse-migrate|lwql-provision|system-migrations-pass|task upgrade|migrate deploy/;
const ENTRY = /^node --experimental-transform-types .*src\/main\.ts$/;

describe("the API start path", () => {
  describe("given the production start commands of the api and the worker", () => {
    /** @scenario "Serving processes never migrate; they refuse by name when behind" */
    /** @scenario "The API listens only after its upgrade gate admitted it" */
    it("runs only the entry point, which composes the upgrade gate before it serves", () => {
      for (const app of ["api", "worker"]) {
        const start = scriptsOf(app)["start"] ?? "";
        expect(start).toMatch(ENTRY);
        expect(start).not.toMatch(MIGRATES);
        expect(readFromRoot(`apps/${app}/src/main.ts`)).toContain(
          `.withUpgradeGate({ role: "${app}", gate: servingUpgradeGate })`,
        );
      }
    });
  });

  describe("given the preparation script", () => {
    /** @scenario "A failed upgrade stops the preparation" */
    it("chains the system-migrations pass behind the upgrade with &&", () => {
      expect(scripts["start:prepare:db"]).toBe(
        "cd ../tasks && pnpm --silent task upgrade && pnpm --silent task system-migrations-pass",
      );
    });
  });

  describe("given the development command", () => {
    /** @scenario "The development start path leaves preparation to the stack" */
    it("starts the supervised process and prepares nothing", () => {
      const dev = scripts["dev"] ?? "";
      expect(dev).toContain("src/main.ts");
      expect(dev).not.toMatch(/start:prepare|prisma-migrate|clickhouse-migrate|migrate/);
    });
  });

  describe("given the production image", () => {
    /** @scenario "The image serves without migrating, and the preparation is written once" */
    it("starts the API through its own start script and writes no migration step of its own", () => {
      const steps = readFromRoot("infra/docker/Dockerfile")
        .split("\n")
        .filter((line) => !line.trimStart().startsWith("#"));

      expect(steps.filter((line) => line.startsWith("CMD "))).toEqual([
        "CMD cd /app/apps/api && pnpm --silent run start",
      ]);
      expect(steps.filter((line) => MIGRATES.test(line))).toEqual([]);
    });
  });

  describe("given the worker and the browser application", () => {
    /** @scenario "The browser application and the worker never migrate" */
    it("starts neither through a preparation, and the worker behind the same gate", () => {
      const [worker, ui] = ["worker", "ui"].map(scriptsOf);

      for (const name of ["predev", "dev", "build", "start"]) {
        expect(ui?.[name] ?? "").not.toMatch(MIGRATES);
        expect(worker?.[name] ?? "").not.toMatch(MIGRATES);
      }
      expect(worker?.["start:prepare:db"]).toBeUndefined();
      expect(readFromRoot("apps/worker/src/main.ts")).toContain("servingUpgradeGate");
    });
  });
});
