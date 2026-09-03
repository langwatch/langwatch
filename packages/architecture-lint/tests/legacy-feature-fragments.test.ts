import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  collectLegacyFeatureFragments,
  formatLegacyFeatureFragmentBaseline,
  lintWorkspace,
} from "../src";
import type { ArchitectureViolation } from "../src";

let root = "";

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "langwatch-legacy-feature-fragments-"));
  write(
    "packages/features/catalogue.json",
    JSON.stringify({
      version: 0,
      features: [
        {
          id: "dataset",
          root: "packages/features/dataset",
          classification: "core",
          subjects: ["dataset"],
        },
      ],
    }),
  );
  write("packages/features/dataset/feature.json", JSON.stringify({ layoutVersion: 0 }));
  write(
    "packages/features/dataset/server/package.json",
    JSON.stringify({ name: "@langwatch/dataset-server", type: "module" }),
  );
  write("packages/features/dataset/server/src/index.ts", "export {};");
  write(
    "packages/features/dataset/server/src/services/dataset.service.ts",
    "export class DatasetService {}",
  );
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function write(path: string, content: string): void {
  const absolute = join(root, path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, content, "utf8");
}

function fragmentViolations(): ArchitectureViolation[] {
  return lintWorkspace({ root, declarations: false }).filter((violation) =>
    violation.policy.startsWith("legacy-feature-fragment"),
  );
}

function baseline(): void {
  const discovery = {
    catalogue: [
      {
        id: "dataset",
        root: "packages/features/dataset",
        classification: "core" as const,
        subjects: ["dataset"],
      },
    ],
    packages: [
      {
        name: "@langwatch/dataset-server",
        root: join(root, "packages/features/dataset/server"),
        manifestPath: join(root, "packages/features/dataset/server/package.json"),
        manifest: {},
        kind: "server" as const,
        feature: "dataset",
        enterprise: false,
      },
    ],
  };
  write(
    "packages/architecture-lint/src/legacy-feature-fragment-baseline.json",
    formatLegacyFeatureFragmentBaseline(
      collectLegacyFeatureFragments(root, discovery.catalogue, discovery.packages),
    ),
  );
}

describe("shrinking legacy feature fragment inventory", () => {
  it("records path-shaped legacy implementation and page-shell fragments", () => {
    write(
      "platform/app/src/server/datasets/dataset.service.ts",
      "export class LegacyDatasetService {}",
    );
    write(
      "platform/app/src/components/datasets/DatasetCard.tsx",
      "export const DatasetCard = () => null;",
    );
    write("platform/app/src/components/datasets/DatasetCard.test.tsx", "export {};");

    baseline();

    expect(fragmentViolations()).toEqual([]);
    expect(
      collectLegacyFeatureFragments(
        root,
        [
          {
            id: "dataset",
            root: "packages/features/dataset",
            classification: "core",
            subjects: ["dataset"],
          },
        ],
        [
          {
            name: "@langwatch/dataset-server",
            root: join(root, "packages/features/dataset/server"),
            manifestPath: join(root, "packages/features/dataset/server/package.json"),
            manifest: {},
            kind: "server",
            feature: "dataset",
            enterprise: false,
          },
        ],
      ),
    ).toEqual([
      {
        feature: "dataset",
        file: "platform/app/src/components/datasets/DatasetCard.tsx",
        kind: "page-shell",
      },
      {
        feature: "dataset",
        file: "platform/app/src/server/datasets/dataset.service.ts",
        kind: "legacy-implementation",
      },
    ]);
  });

  it("rejects a new matching fragment and a stale inventory entry", () => {
    write(
      "platform/app/src/server/datasets/dataset.service.ts",
      "export class LegacyDatasetService {}",
    );
    baseline();
    write(
      "platform/app/src/hooks/datasets/useDataset.ts",
      "export const useDataset = () => null;",
    );

    expect(fragmentViolations()).toEqual([
      expect.objectContaining({ policy: "legacy-feature-fragment" }),
    ]);

    rmSync(join(root, "platform/app/src/server/datasets/dataset.service.ts"));
    expect(fragmentViolations()).toContainEqual(
      expect.objectContaining({
        policy: "legacy-feature-fragment-baseline",
        message: expect.stringContaining("must be removed"),
      }),
    );
  });

  it("rejects an empty baseline file as a retained exception surface (R9)", () => {
    write(
      "packages/architecture-lint/src/legacy-feature-fragment-baseline.json",
      JSON.stringify({ version: 0, fragments: [] }),
    );

    expect(fragmentViolations()).toContainEqual(
      expect.objectContaining({
        policy: "legacy-feature-fragment-baseline",
        message: expect.stringContaining("must be deleted"),
      }),
    );
  });

  it("does not fail when no baseline file exists at all", () => {
    expect(fragmentViolations()).toEqual([]);
  });

  it("validates canonical ordering and duplicate feature/file entries", () => {
    write(
      "platform/app/src/server/datasets/dataset.service.ts",
      "export class LegacyDatasetService {}",
    );
    write(
      "packages/architecture-lint/src/legacy-feature-fragment-baseline.json",
      JSON.stringify({
        version: 0,
        fragments: [
          {
            feature: "dataset",
            file: "platform/app/src/server/datasets/dataset.service.ts",
            kind: "legacy-implementation",
          },
          {
            feature: "dataset",
            file: "platform/app/src/server/datasets/dataset.service.ts",
            kind: "transport",
          },
        ],
      }),
    );

    expect(fragmentViolations()).toContainEqual(
      expect.objectContaining({
        message: expect.stringContaining("duplicate feature/file"),
      }),
    );

    write(
      "packages/architecture-lint/src/legacy-feature-fragment-baseline.json",
      JSON.stringify({
        version: 0,
        fragments: [
          {
            feature: "dataset",
            file: "platform/app/src/server/z/dataset.service.ts",
            kind: "legacy-implementation",
          },
          {
            feature: "dataset",
            file: "platform/app/src/server/a/dataset.service.ts",
            kind: "legacy-implementation",
          },
        ],
      }),
    );

    expect(fragmentViolations()).toContainEqual(
      expect.objectContaining({ message: expect.stringContaining("must be sorted") }),
    );
  });
});
