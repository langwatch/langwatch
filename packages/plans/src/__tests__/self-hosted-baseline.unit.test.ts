import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { planCatalogue } from "../catalogue.ts";
import { LIMIT_NAMES, UNLIMITED } from "../limits.ts";

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "../..");

describe("given a self-hosted deployment with no licence", () => {
  describe("when the baseline is resolved", () => {
    /** @scenario "A deployment with no licence resolves to an uncapped plan" */
    it("resolves the open-source plan with no limit that caps", () => {
      const baseline = planCatalogue.baseline("self-hosted");

      expect(baseline.type).toBe("OPEN_SOURCE");
      const capped = LIMIT_NAMES.filter((name) => {
        const limit = baseline.limits[name];
        return limit !== null && limit !== undefined && limit.value < UNLIMITED;
      });
      expect(capped).toEqual([]);
    });
  });
});

describe("given the package the catalogue lives in", () => {
  describe("when its licence is read", () => {
    /** @scenario "The catalogue ships under the open-source licence" */
    it("carries the licence the other shared packages carry", () => {
      const manifest = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8"));

      expect(manifest.name).toBe("@langwatch/plans");
      expect(manifest.license).toBe("MIT");
      expect(packageRoot.includes("/enterprise/")).toBe(false);
      expect(Object.keys(manifest.dependencies)).toEqual(["zod"]);
    });
  });
});
