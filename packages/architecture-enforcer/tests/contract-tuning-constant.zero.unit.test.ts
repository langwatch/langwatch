/**
 * Spec: specs/contract-export-visibility.feature.
 * Record: dev/docs/plans/platform-architecture-blocks.md rules 12b and 12c, fix rules: the real
 * tree holds no such import.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { collectTuningImports } from "../src/policies/boundaries/contract-tuning-constant.ts";
import { buildWorkspaceSnapshot } from "../src/workspace/snapshot.ts";

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(here, "..", "..", "..");

describe("contract-tuning-constant on the repository", () => {
  describe("when the real tree is read", () => {
    it("finds no import of a contract export a peer module may not use", () => {
      const snapshot = buildWorkspaceSnapshot({ root: REPO_ROOT, changedFiles: [] });
      const findings = collectTuningImports(snapshot).map(
        (finding) =>
          `${finding.file}:${finding.line} ${finding.export.name} <- ${finding.export.module}`,
      );

      expect(findings).toEqual([]);
    }, 120_000);
  });
});
