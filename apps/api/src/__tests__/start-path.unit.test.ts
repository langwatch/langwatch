import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

function readFromRoot(relative: string): string {
  return readFileSync(fileURLToPath(new URL(`../../../../${relative}`, import.meta.url)), "utf8");
}

const scripts: Record<string, string> = JSON.parse(readFromRoot("apps/api/package.json")).scripts;
const PREPARE = "pnpm --silent run start:prepare:db";

describe("the API start path", () => {
  describe("given the production start command", () => {
    /** @scenario "The API process applies pending schema migrations before it serves" */
    it("runs the migration tasks in their order, and only then the entry point", () => {
      expect(scripts["start:prepare:db"]).toMatch(
        /task prisma-migrate clickhouse-migrate lwql-provision/,
      );
      expect(scripts["start"]?.startsWith(`${PREPARE} && node `)).toBe(true);
      expect(scripts["start"]?.endsWith("src/main.ts")).toBe(true);
    });

    /** @scenario "The API listens only after preparation succeeded" */
    /** @scenario "A failed migration stops the boot instead of serving" */
    it("chains the entry point behind preparation with &&, so a failed preparation never reaches it", () => {
      const start = scripts["start"] ?? "";
      expect(start.indexOf(" && ")).toBe(PREPARE.length);
      expect(start.slice(PREPARE.length + 4)).toMatch(/^node .*src\/main\.ts$/);
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
    /** @scenario "The image migrates once, through the same script" */
    it("starts the API through its own start script and writes no migration step of its own", () => {
      const steps = readFromRoot("infra/docker/Dockerfile")
        .split("\n")
        .filter((line) => !line.trimStart().startsWith("#"));

      expect(steps.filter((line) => line.startsWith("CMD "))).toEqual([
        "CMD cd /app/apps/api && pnpm --silent run start",
      ]);
      expect(
        steps.filter((line) =>
          /prisma\s+migrate|migrate deploy|prisma-migrate|clickhouse-migrate|start:prepare:db/.test(
            line,
          ),
        ),
      ).toEqual([]);
    });
  });
});
