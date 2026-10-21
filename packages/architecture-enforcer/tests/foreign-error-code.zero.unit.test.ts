/**
 * Spec: specs/foreign-error-code.feature. Record: dev/docs/plans/platform-architecture-blocks.md
 * rule 2, a fix rule: the real tree holds no foreign error code literal.
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { describe, expect, it } from "vitest";

import { collectForeignErrorCodes } from "../src/policies/boundaries/foreign-error-code.ts";
import { buildWorkspaceSnapshot } from "../src/workspace/snapshot.ts";

const here = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = join(here, "..", "..", "..");

describe("foreign-error-code on the repository", () => {
  describe("when the real tree is read", () => {
    it("finds no module spelling a peer's error code", () => {
      const snapshot = buildWorkspaceSnapshot({ root: REPO_ROOT, changedFiles: [] });
      const findings = collectForeignErrorCodes(snapshot).map(
        (finding) =>
          `${finding.file}:${finding.line} ${finding.use} ${finding.code} -> ${finding.owners
            .map((owner) => `${owner.className}@${owner.contract}`)
            .join(",")}`,
      );

      expect(findings).toEqual([]);
    }, 120_000);
  });
});
