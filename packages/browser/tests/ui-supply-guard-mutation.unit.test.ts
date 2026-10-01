import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

import { describe, expect, it } from "vitest";

const packageRoot = resolve(import.meta.dirname, "..");

describe("UI supply render guard", () => {
  it("makes the refusal tests fail when the guard is removed in memory", () => {
    const directory = mkdtempSync(resolve(packageRoot, ".render-guard-mutation-"));
    try {
      cpSync(resolve(packageRoot, "src"), resolve(directory, "src"), { recursive: true });
      mkdirSync(resolve(directory, "tests"));
      mkdirSync(resolve(directory, "type-tests"));
      cpSync(
        resolve(packageRoot, "tests/ui-supply.fixtures.ts"),
        resolve(directory, "tests/ui-supply.fixtures.ts"),
      );
      cpSync(
        resolve(packageRoot, "type-tests/ui-supply.ts"),
        resolve(directory, "type-tests/ui-supply.ts"),
      );

      const supplyPath = resolve(directory, "src/ui-supply.ts");
      const source = readFileSync(supplyPath, "utf8");
      const mutated = source.replace(
        /\[\s*keyof Outstanding,?\s*\]\s+extends \[never\]/,
        "true extends true",
      );
      if (mutated === source) throw new Error("The render guard mutation did not apply.");
      writeFileSync(supplyPath, mutated);
      writeFileSync(
        resolve(directory, "tsconfig.json"),
        JSON.stringify({
          compilerOptions: {
            allowImportingTsExtensions: true,
            lib: ["ES2023", "DOM", "DOM.Iterable"],
            module: "ESNext",
            moduleResolution: "Bundler",
            noEmit: true,
            noUncheckedIndexedAccess: true,
            skipLibCheck: true,
            strict: true,
            target: "ES2022",
          },
          include: ["src/**/*.ts", "tests/ui-supply.fixtures.ts", "type-tests/**/*.ts"],
        }),
      );

      let output = "";
      try {
        execFileSync(
          resolve(packageRoot, "node_modules/typescript/bin/tsc"),
          ["--project", resolve(directory, "tsconfig.json"), "--pretty", "false"],
          { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
        );
      } catch (error) {
        if (!(error instanceof Error) || !("stdout" in error) || typeof error.stdout !== "string") {
          throw error;
        }
        output = error.stdout;
      }

      expect(output).toContain("Unused '@ts-expect-error' directive");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
