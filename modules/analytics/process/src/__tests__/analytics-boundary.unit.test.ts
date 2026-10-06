/**
 * Structural proof that Analytics owns timeseries only: no saved-chart or topic state lives in its
 * repositories, and the features that need timeseries do not reach into its process package.
 * @see modules/analytics/specs/analytics-timeseries.feature
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

const MODULES = join(import.meta.dirname, "..", "..", "..", "..");
const ANALYTICS_REPOSITORIES = join(MODULES, "analytics", "process", "src", "repositories");

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (entry === "__tests__" || entry === "node_modules") return [];
    if (statSync(path).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(path) ? [path] : [];
  });
}

describe("the Analytics feature boundary", () => {
  describe("when Dashboard and Topic need timeseries data", () => {
    /** @scenario "Analytics does not own product lifecycles" */
    it("owns no Dashboard or Topic repository and is consumed through its contract only", () => {
      const owned = sourceFiles(ANALYTICS_REPOSITORIES)
        .filter((file) => !file.includes(`${join("repositories", "")}__`))
        .filter(
          (file) =>
            /(dashboard|topic)/i.test(file.slice(ANALYTICS_REPOSITORIES.length)) ||
            /(dashboard|topic)[\w-]*\.repository/i.test(readFileSync(file, "utf8")),
        );
      const reachers = ["dashboard", "topic"].flatMap((feature) =>
        sourceFiles(join(MODULES, feature, "process", "src")).filter((file) =>
          /@langwatch\/analytics-process/.test(readFileSync(file, "utf8")),
        ),
      );

      expect(owned).toEqual([]);
      expect(reachers).toEqual([]);
    });
  });
});
