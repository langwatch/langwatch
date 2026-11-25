/**
 * @vitest-environment node
 * @see specs/dependencies/runtime-composition.feature
 */
import { readFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { walkFiles } from "../src/workspace/layout.ts";

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "..");
const SINGLETON_IMPORT =
  /import\s+(?:type\s+)?\{[^}]*\b(?:getApp|initializeDefaultApp|AppDependencies)\b[^}]*\}\s+from/;
const IGNORED = new Set(["node_modules", "dist", ".worktrees"]);

const featureSources = ["modules", "enterprise/modules"].flatMap((root) =>
  walkFiles(join(REPO_ROOT, root), (path) => /\.(?:mts|cts|tsx?)$/.test(path), {
    ignoredDirectories: IGNORED,
  }),
);

describe("given every module's source", () => {
  describe("when a feature is composed", () => {
    /** @scenario "New features do not use the global App singleton" */
    it("imports none of getApp, initializeDefaultApp or AppDependencies", () => {
      const offenders = featureSources
        .filter((file) => SINGLETON_IMPORT.test(readFileSync(file, "utf8")))
        .map((file) => relative(REPO_ROOT, file));

      expect(featureSources.length).toBeGreaterThan(100);
      expect(offenders).toEqual([]);
    });
  });
});
