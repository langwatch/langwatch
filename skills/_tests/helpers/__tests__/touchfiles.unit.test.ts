import { describe, it, expect } from "vitest";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { TOUCHFILES, GLOBAL_TOUCHFILES } from "../touchfiles";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/**
 * Extract test descriptions from all scenario test files.
 * Parses `it(` and `it.skipIf(...)(`  calls to find the description string.
 */
function extractTestDescriptions(): string[] {
  const testsDir = path.resolve(__dirname, "../../");
  const scenarioFiles = fs
    .readdirSync(testsDir)
    .filter((f) => f.endsWith(".scenario.test.ts"));

  const descriptions: string[] = [];

  for (const file of scenarioFiles) {
    const content = fs.readFileSync(path.join(testsDir, file), "utf8");
    // Match it("...", it.skipIf(...)("...",
    const regex = /it(?:\.skipIf\([^)]*\))?\(\s*["'`]((?:[^"'`\\]|\\.)*)["'`]/g;
    let match;
    while ((match = regex.exec(content)) !== null) {
      descriptions.push(match[1]!);
    }
  }

  return descriptions;
}

describe("TOUCHFILES", () => {
  const testDescriptions = extractTestDescriptions();

  describe("when compared against scenario test files", () => {
    it("has an entry for every scenario test description", () => {
      const touchfileKeys = Object.keys(TOUCHFILES);
      const missing = testDescriptions.filter(
        (desc) => !touchfileKeys.includes(desc)
      );
      expect(
        missing,
        `Missing touchfile entries for tests:\n${missing.map((m) => `  - "${m}"`).join("\n")}`
      ).toEqual([]);
    });

    it("has no orphaned entries pointing to nonexistent tests", () => {
      const touchfileKeys = Object.keys(TOUCHFILES);
      const orphaned = touchfileKeys.filter(
        (key) => !testDescriptions.includes(key)
      );
      expect(
        orphaned,
        `Orphaned touchfile entries (no matching test):\n${orphaned.map((o) => `  - "${o}"`).join("\n")}`
      ).toEqual([]);
    });
  });

  describe("when checking touchfile patterns", () => {
    it("every test has at least one pattern", () => {
      for (const [testName, patterns] of Object.entries(TOUCHFILES)) {
        expect(
          patterns.length,
          `Test "${testName}" has no touchfile patterns`
        ).toBeGreaterThan(0);
      }
    });

    it("all patterns reference directories that exist (base path before glob)", () => {
      const repoRoot = path.resolve(__dirname, "../../../../");
      const allPatterns = [
        ...Object.values(TOUCHFILES).flat(),
        ...GLOBAL_TOUCHFILES,
      ];
      const uniqueBasePaths = new Set<string>();

      for (const pattern of allPatterns) {
        // Extract the base path before the first glob character (* or **)
        const basePath = pattern.split("*")[0]!.replace(/\/$/, "");
        if (basePath) {
          uniqueBasePaths.add(basePath);
        }
      }

      const missing: string[] = [];
      for (const basePath of uniqueBasePaths) {
        const fullPath = path.join(repoRoot, basePath);
        if (!fs.existsSync(fullPath)) {
          missing.push(basePath);
        }
      }

      expect(
        missing,
        `Touchfile patterns reference nonexistent paths:\n${missing.map((m) => `  - "${m}"`).join("\n")}`
      ).toEqual([]);
    });
  });
});

describe("GLOBAL_TOUCHFILES", () => {
  it("includes skills/_tests/helpers/**", () => {
    expect(GLOBAL_TOUCHFILES).toContain("skills/_tests/helpers/**");
  });

  it("includes skills/_tests/vitest.config.ts", () => {
    expect(GLOBAL_TOUCHFILES).toContain("skills/_tests/vitest.config.ts");
  });

  it("includes skills/_tests/package.json", () => {
    expect(GLOBAL_TOUCHFILES).toContain("skills/_tests/package.json");
  });

  it("includes skills/_compiler/**", () => {
    expect(GLOBAL_TOUCHFILES).toContain("skills/_compiler/**");
  });
});
