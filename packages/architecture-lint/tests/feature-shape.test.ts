import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  collectFeatureShapeBaseline,
  collectFeatureShapeFindings,
  formatFeatureShapeBaseline,
  lintFeatureShape,
  type ClassifiedPackage,
  type FeatureCatalogueEntry,
} from "../src/index.ts";

let root = "";
const catalogue: FeatureCatalogueEntry[] = [
  { id: "widget", root: "packages/features/widget", classification: "core", subjects: ["widget"] },
];

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "feature-shape-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function write(path: string, content = "export {};\n"): void {
  const absolute = join(root, path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, content, "utf8");
}

function pkg(kind: "contract" | "server", feature = "widget"): ClassifiedPackage {
  const featureRoot = join(root, `packages/features/${feature}`);
  const directory = join(featureRoot, kind);

  return {
    name: `@langwatch/${feature}-${kind}`,
    root: directory,
    manifestPath: join(directory, "package.json"),
    manifest: {},
    kind,
    feature,
    featureRoot,
    layoutVersion: 0,
    subjects: [feature],
    enterprise: false,
  };
}

/** The annotation reference shape, reduced to the paths the policy reads. */
function referenceFeature(): void {
  write("packages/features/widget/contract/src/widget.api.ts");
  write("packages/features/widget/server/src/widget.server.ts");
  write("packages/features/widget/server/src/app/widget.app.ts");
  write("packages/features/widget/server/src/app/__tests__/widget.fixture.ts");
  write("packages/features/widget/server/src/services/widget.service.ts");
  write("packages/features/widget/server/src/repositories/widget.repository.ts");
  write("packages/features/widget/server/src/repositories/widget-repositories.registry.ts");
  write("packages/features/widget/server/src/repositories/prisma/prisma.widget.repository.ts");
  write("packages/features/widget/server/src/repositories/memory/memory.widget.repository.ts");
  write("packages/features/widget/server/src/transport/widget.rest.ts");
  write("packages/features/widget/server/src/transport/widget.trpc.ts");
}

function findings() {
  return collectFeatureShapeFindings(root, catalogue, [pkg("contract"), pkg("server")]);
}

function violations() {
  return lintFeatureShape(root, catalogue, [pkg("contract"), pkg("server")]);
}

function baseline(entries: readonly { feature: string; kind: string }[]): void {
  write(
    "packages/architecture-lint/src/feature-shape-baseline.json",
    JSON.stringify({ version: 0, entries }),
  );
}

describe("feature shape", () => {
  describe("given a feature laid out like the annotation reference", () => {
    /** @scenario "A pre-reference feature shape is inventoried, never admitted" */
    it("reports nothing", () => {
      referenceFeature();

      expect(findings()).toEqual([]);
      expect(violations()).toEqual([]);
    });

    it("ignores a repositories/prisma folder that has its memory twin", () => {
      referenceFeature();

      expect(findings().map((finding) => finding.kind)).not.toContain("postgres-without-memory");
    });
  });

  describe("given a feature still carrying the older shape", () => {
    beforeEach(() => {
      referenceFeature();
      write("packages/features/widget/contract/src/widget.service.ts");
      write("packages/features/widget/server/src/adapters/postgres.widget.adapter.ts");
      write("packages/features/widget/server/src/fixtures/widget.fixture.ts");
      write("packages/features/widget/server/src/testing.ts");
      write("packages/features/widget/server/src/transport/api-trpc/widget.api.ts");
    });

    /** @scenario "A pre-reference feature shape is inventoried, never admitted" */
    it("names every legacy piece once, with the path that carries it", () => {
      expect(findings()).toEqual([
        {
          feature: "widget",
          kind: "contract-service",
          path: "packages/features/widget/contract/src/widget.service.ts",
        },
        {
          feature: "widget",
          kind: "fixtures-directory",
          path: "packages/features/widget/server/src/fixtures",
        },
        {
          feature: "widget",
          kind: "nested-transport",
          path: "packages/features/widget/server/src/transport/api-trpc",
        },
        {
          feature: "widget",
          kind: "persistence-adapter",
          path: "packages/features/widget/server/src/adapters/postgres.widget.adapter.ts",
        },
        {
          feature: "widget",
          kind: "testing-entry",
          path: "packages/features/widget/server/src/testing.ts",
        },
      ]);
    });

    /** @scenario "A pre-reference feature shape is inventoried, never admitted" */
    it("rejects each piece that the baseline does not list, pointing at the reference shape", () => {
      const rejected = violations().filter((violation) => violation.policy === "feature-shape");

      expect(rejected).toHaveLength(5);
      expect(rejected.map((violation) => violation.allowed)).toEqual(
        expect.arrayContaining([expect.stringContaining("defineTransport")]),
      );
    });

    it("admits exactly the listed pieces", () => {
      baseline([
        { feature: "widget", kind: "contract-service" },
        { feature: "widget", kind: "fixtures-directory" },
        { feature: "widget", kind: "nested-transport" },
        { feature: "widget", kind: "persistence-adapter" },
        { feature: "widget", kind: "testing-entry" },
      ]);

      expect(violations()).toEqual([]);
    });

    /** @scenario "A pre-reference feature shape is inventoried, never admitted" */
    it("marks a baseline entry stale once the piece is gone", () => {
      baseline([
        { feature: "widget", kind: "contract-service" },
        { feature: "widget", kind: "fixtures-directory" },
        { feature: "widget", kind: "nested-transport" },
        { feature: "widget", kind: "persistence-adapter" },
        { feature: "widget", kind: "testing-entry" },
      ]);
      rmSync(join(root, "packages/features/widget/server/src/testing.ts"));

      expect(violations()).toMatchObject([
        {
          policy: "feature-shape-baseline",
          message: expect.stringContaining("widget/testing-entry"),
        },
      ]);
    });

    it("collects and formats the inventory as one sorted entry per feature and kind", () => {
      const entries = collectFeatureShapeBaseline(root, catalogue, [
        pkg("contract"),
        pkg("server"),
      ]);

      expect(entries.map((entry) => entry.kind)).toEqual([
        "contract-service",
        "fixtures-directory",
        "nested-transport",
        "persistence-adapter",
        "testing-entry",
      ]);
      expect(formatFeatureShapeBaseline(entries)).toBe(
        `{\n  "version": 0,\n  "entries": [\n${entries
          .map(
            (entry, index) =>
              `    ${JSON.stringify(entry)}${index + 1 === entries.length ? "" : ","}`,
          )
          .join("\n")}\n  ]\n}\n`,
      );
    });
  });

  describe("given a repositories folder without the reference's selection", () => {
    it("asks for a registry when repositories are not selected by one", () => {
      referenceFeature();
      rmSync(
        join(
          root,
          "packages/features/widget/server/src/repositories/widget-repositories.registry.ts",
        ),
      );

      expect(findings().map((finding) => finding.kind)).toEqual(["unregistered-repositories"]);
    });

    it("asks for the memory twin when only Prisma repositories exist", () => {
      referenceFeature();
      rmSync(join(root, "packages/features/widget/server/src/repositories/memory"), {
        recursive: true,
      });

      expect(findings().map((finding) => finding.kind)).toEqual(["postgres-without-memory"]);
    });
  });

  describe("given the baseline file itself", () => {
    it("refuses an empty baseline kept as an exception surface", () => {
      referenceFeature();
      baseline([]);

      expect(violations()).toMatchObject([
        { policy: "feature-shape-baseline", message: expect.stringContaining("empty") },
      ]);
    });

    it("refuses an unsorted or duplicated inventory", () => {
      referenceFeature();
      write("packages/features/widget/server/src/testing.ts");
      write("packages/features/widget/contract/src/widget.service.ts");
      baseline([
        { feature: "widget", kind: "testing-entry" },
        { feature: "widget", kind: "contract-service" },
      ]);

      expect(violations()).toMatchObject([
        { policy: "feature-shape-baseline", message: expect.stringContaining("sorted") },
      ]);
    });

    it("measures only catalogue features", () => {
      write("packages/features/other/server/src/testing.ts");

      expect(collectFeatureShapeFindings(root, catalogue, [pkg("server", "other")])).toEqual([]);
    });
  });
});
