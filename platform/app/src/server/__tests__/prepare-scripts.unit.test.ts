import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

// vitest runs from the app package root, so the repository root is two levels up.
const REPO_ROOT = resolve(process.cwd(), "../..");

type Scripts = Record<string, string | undefined>;

const scriptsOf = (path: string): Scripts =>
  JSON.parse(readFileSync(resolve(REPO_ROOT, path), "utf8")).scripts ?? {};

const APP_GENERATOR_CHAIN = "start:prepare:files";

describe("given a fresh checkout without generated files", () => {
  describe("when either documented name is invoked from the repository root", () => {
    // @scenario "Both documented names reach the same generator chain"
    it("routes both root script names to the app generator chain", () => {
      const root = scriptsOf("package.json");

      expect(
        scriptsOf("platform/app/package.json")[APP_GENERATOR_CHAIN],
      ).toBeDefined();
      for (const name of ["prepare:files", "start:prepare:files"]) {
        expect(root[name]).toBe(
          `pnpm --filter @langwatch/web ${APP_GENERATOR_CHAIN}`,
        );
      }
    });
  });

  describe("when the app build and development scripts call their generator chain by name", () => {
    // @scenario "The app keeps the generator chain its build calls by name"
    it("keeps the chain under start:prepare:files in the app package", () => {
      const app = scriptsOf("platform/app/package.json");
      const callers = ["build", "dev:app", "dev:worker"];

      for (const caller of callers) {
        expect(app[caller]).toContain(APP_GENERATOR_CHAIN);
      }
    });
  });

  describe("when contributing documentation tells a newcomer how to generate the files", () => {
    // @scenario "Setup guidance names a script that exists where it says to run it"
    it("names only commands that exist in the scripts they target", () => {
      const contributing = readFileSync(
        resolve(REPO_ROOT, "CONTRIBUTING.md"),
        "utf8",
      );
      const root = scriptsOf("package.json");

      const fenced = [...contributing.matchAll(/```bash\n([\s\S]*?)```/g)].map(
        (match) => match[1] ?? "",
      );
      const setupBlock = fenced.find((block) =>
        block.includes("prepare:files"),
      );
      if (!setupBlock) {
        expect.fail("CONTRIBUTING.md lost its bash block naming the command");
      }

      const named = [...setupBlock.matchAll(/pnpm ([a-z:.-]+)/g)].flatMap(
        (match) => (match[1] ? [match[1]] : []),
      );
      expect(named.length).toBeGreaterThan(0);
      for (const name of named) {
        expect(root[name]).toBeDefined();
      }
    });
  });
});
