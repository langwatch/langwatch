/**
 * Spec: specs/tooling/lint-runtime-dev-dependency.feature.
 * Record: dev/docs/plans/platform-architecture-blocks.md, a fix rule: the real tree holds no such
 * import.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { collectRuntimeDevDependencyImports } from "../src/policies/boundaries/runtime-dev-dependency.ts";
import { buildWorkspaceSnapshot } from "../src/workspace/snapshot.ts";

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(here, "..", "..", "..");

describe("runtime-dev-dependency on the repository", () => {
  describe("when the real tree is read", () => {
    /** @scenario "The real tree holds no such import" */
    it("finds no value import of a package a manifest lists only in devDependencies", () => {
      const snapshot = buildWorkspaceSnapshot({ root: REPO_ROOT, changedFiles: [] });
      const findings = collectRuntimeDevDependencyImports(snapshot).map(
        (finding) => `${finding.file}:${finding.line} ${finding.packageName} (${finding.manifest})`,
      );

      expect(findings).toEqual([]);
    }, 120_000);
  });
});
