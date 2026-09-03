import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { readFeatureCatalogue, type ArchitectureViolation } from "../src";

let root = "";

function writeCatalogue(catalogue: unknown): void {
  const directory = join(root, "packages/features");
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, "catalogue.json"), JSON.stringify(catalogue));
}

function read(): {
  entries: ReturnType<typeof readFeatureCatalogue>;
  violations: ArchitectureViolation[];
} {
  const violations: ArchitectureViolation[] = [];
  const entries = readFeatureCatalogue(root, violations);

  return { entries, violations };
}

describe("feature catalogue", () => {
  afterEach(() => {
    if (root) {
      rmSync(root, { recursive: true, force: true });
    }

    root = "";
  });

  it("accepts a typed, sorted catalogue", () => {
    root = mkdtempSync(join(tmpdir(), "feature-catalogue-"));
    writeCatalogue({
      version: 0,
      features: [
        {
          classification: "core",
          id: "api-key",
          root: "packages/features/api-key",
          subjects: ["api-key", "credential"],
        },
        {
          classification: "enterprise",
          id: "governance",
          root: "packages/enterprise/features/governance",
          subjects: ["governance"],
        },
      ],
    });

    const result = read();

    expect(result.violations).toEqual([]);
    expect(result.entries.map((entry) => entry.id)).toEqual(["api-key", "governance"]);
  });

  it("rejects extra entry keys before domain validation", () => {
    root = mkdtempSync(join(tmpdir(), "feature-catalogue-"));
    writeCatalogue({
      version: 0,
      features: [
        {
          classification: "core",
          id: "user",
          root: "packages/features/user",
          subjects: ["user"],
          owner: "platform",
        },
      ],
    });

    const result = read();

    expect(result.entries).toEqual([]);
    expect(result.violations.map((violation) => violation.message)).toEqual([
      "Feature catalogue entry 0 must contain only id, root, classification, and subjects.",
    ]);
  });

  it("rejects unsorted or duplicate subjects as one malformed entry", () => {
    root = mkdtempSync(join(tmpdir(), "feature-catalogue-"));
    writeCatalogue({
      version: 0,
      features: [
        {
          classification: "core",
          id: "project",
          root: "packages/features/project",
          subjects: ["team", "project", "project"],
        },
      ],
    });

    const result = read();

    expect(result.entries).toEqual([]);
    expect(result.violations.map((violation) => violation.message)).toEqual([
      "Feature catalogue entry 0 is malformed.",
    ]);
  });

  /** @scenario "Every production subject has exactly one owner" */
  it("keeps cross-entry ownership checks after schema parsing", () => {
    root = mkdtempSync(join(tmpdir(), "feature-catalogue-"));
    writeCatalogue({
      version: 0,
      features: [
        {
          classification: "core",
          id: "organization",
          root: "packages/features/organization",
          subjects: ["membership"],
        },
        {
          classification: "core",
          id: "user",
          root: "packages/features/user",
          subjects: ["membership"],
        },
      ],
    });

    const result = read();

    expect(result.entries).toHaveLength(2);
    expect(result.violations.map((violation) => violation.message)).toContain(
      'Subject "membership" is owned by both "organization" and "user".',
    );
  });
});
