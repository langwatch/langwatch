import { execFileSync } from "node:child_process";
import path from "node:path";

import { describe, expect, it } from "vitest";

const PACKAGE_ROOT = path.resolve(import.meta.dirname, "..", "..");

/** @see specs/scenarios/pre-compiled-child-process.feature */
describe("scenario child dev spawn", () => {
  describe("when the bundle is stale and the api falls back to pnpm exec tsx", () => {
    it("resolves tsx from this package", () => {
      const version = execFileSync("pnpm", ["exec", "tsx", "--version"], {
        cwd: PACKAGE_ROOT,
        encoding: "utf8",
      });

      expect(version).toContain("tsx v");
    });
  });
});
