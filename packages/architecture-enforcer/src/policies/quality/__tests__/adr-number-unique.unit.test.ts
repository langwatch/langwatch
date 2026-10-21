/**
 * Spec: specs/literal-ownership.feature (adr-number-unique).
 * Record: dev/docs/plans/platform-architecture-blocks.md rule 10.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildWorkspaceSnapshot } from "../../../workspace/snapshot.ts";
import { collectAdrNumberCollisions, lintAdrNumberUniqueness } from "../adr-number-unique.ts";

let root = "";

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "langwatch-adr-numbers-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function write(path: string): void {
  const file = join(root, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, "# ADR\n");
}

function snapshot() {
  return buildWorkspaceSnapshot({ root, changedFiles: [] });
}

describe("adr-number-unique", () => {
  describe("when two records in one folder share a number", () => {
    /** @scenario "Two ADRs sharing a number in one folder are reported" */
    it("reports both records under the folder and number", () => {
      write("dev/docs/adr/007-one.md");
      write("dev/docs/adr/007-two.md");
      write("dev/docs/adr/008-three.md");

      expect(collectAdrNumberCollisions(snapshot())).toEqual([
        {
          folder: "dev/docs/adr",
          number: "007",
          files: ["dev/docs/adr/007-one.md", "dev/docs/adr/007-two.md"],
        },
      ]);
    });
  });

  describe("when the same number is used in two folders", () => {
    /** @scenario "The same number in two different ADR folders is not reported" */
    it("reports nothing", () => {
      write("dev/docs/adr/001-one.md");
      write("modules/a/adrs/001-boundary.md");
      write("modules/a/adrs/README.md");

      expect(collectAdrNumberCollisions(snapshot())).toEqual([]);
    });
  });

  describe("when a collision is reported", () => {
    /** @scenario "An ADR number finding says to renumber the newer record" */
    it("tells the author to renumber the newer record", () => {
      write("dev/docs/adr/007-one.md");
      write("dev/docs/adr/007-two.md");

      const findings = lintAdrNumberUniqueness(snapshot());

      expect(findings.map((finding) => finding.file)).toEqual([
        "dev/docs/adr/007-one.md",
        "dev/docs/adr/007-two.md",
      ]);
      expect(findings[0]?.allowed).toContain("Give the newer record the next free number");
    });
  });
});
