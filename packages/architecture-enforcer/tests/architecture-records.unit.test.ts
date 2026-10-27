import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, it } from "vitest";

import { lintArchitectureRecords } from "../src/policies/boundaries/architecture-records.ts";
import type { ClassifiedPackage } from "../src/types.ts";
import { snapshotOf } from "./workspace.ts";

const REQUIRED_SECTIONS = [
  "Context",
  "Decision",
  "Public surfaces and transports",
  "Dependencies",
  "Persistence",
  "Runtime and registration",
  "Environment and configuration",
  "Errors",
  "Contracts and validation",
  "Consequences",
] as const;

let root = "";

function write(path: string, contents: string): void {
  const file = join(root, path);
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(file, contents);
}

/** The feature process package whose sibling `adrs`/`specs` the policy scans. */
function serverPackage(): ClassifiedPackage {
  return {
    name: "example-process",
    root: join(root, "modules/example/process"),
    manifestPath: join(root, "modules/example/process/package.json"),
    manifest: {},
    kind: "process",
    feature: "example",
    enterprise: false,
  };
}

function fullRecord(): string {
  const header =
    "# Example boundary\n\n**Status:** Accepted\n\nSee specs/example.feature for the executable contract.\n\n";
  const body = REQUIRED_SECTIONS.map((section) => `## ${section}\n\nfilled in.\n\n`).join("");

  return header + body;
}

function violations(): ReturnType<typeof lintArchitectureRecords> {
  return lintArchitectureRecords(snapshotOf({ root, packages: [serverPackage()] }));
}

describe("architecture-records", () => {
  afterEach(() => {
    if (root) rmSync(root, { recursive: true, force: true });
    root = "";
  });

  describe("given a boundary ADR carrying every required section", () => {
    it("passes with no violations", () => {
      root = mkdtempSync(join(tmpdir(), "architecture-records-"));
      write("modules/example/adrs/README.md", "Index\n\n001-boundary.md\n");
      write("modules/example/adrs/001-boundary.md", fullRecord());
      write("modules/example/specs/example.feature", "Feature: example\n");

      expect(violations()).toEqual([]);
    });
  });

  describe("given a boundary ADR missing one required section", () => {
    it("reports a violation naming the missing section", () => {
      root = mkdtempSync(join(tmpdir(), "architecture-records-"));
      write("modules/example/adrs/README.md", "Index\n\n001-boundary.md\n");
      write(
        "modules/example/adrs/001-boundary.md",
        fullRecord().replace(/## Consequences[\s\S]*$/, ""),
      );
      write("modules/example/specs/example.feature", "Feature: example\n");

      expect(violations()).toEqual([
        expect.objectContaining({
          policy: "architecture-record",
          file: join(root, "modules/example/adrs/001-boundary.md"),
          message: expect.stringContaining('"Consequences"'),
        }),
      ]);
    });
  });

  describe("given an ownership root with no boundary ADR at all", () => {
    it("reports both the missing index and the missing record", () => {
      root = mkdtempSync(join(tmpdir(), "architecture-records-"));
      mkdirSync(join(root, "modules/example/process"), { recursive: true });

      expect(violations()).toEqual([
        expect.objectContaining({
          policy: "architecture-record",
          message: expect.stringContaining("ADR index"),
        }),
        expect.objectContaining({
          policy: "architecture-record",
          message: expect.stringContaining("boundary ADR"),
        }),
      ]);
    });
  });

  describe("given only a README.md inside the adrs directory", () => {
    it("excludes README.md from the scan and still reports no boundary ADR", () => {
      root = mkdtempSync(join(tmpdir(), "architecture-records-"));
      // README.md carries every required section itself - if it were not
      // excluded from the scan, this would wrongly pass as the boundary ADR.
      write("modules/example/adrs/README.md", fullRecord());
      write("modules/example/specs/example.feature", "Feature: example\n");

      expect(violations()).toEqual([
        expect.objectContaining({
          policy: "architecture-record",
          message: expect.stringContaining("boundary ADR"),
        }),
      ]);
    });
  });
});
