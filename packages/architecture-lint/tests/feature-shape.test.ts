import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  FEATURE_SHAPE_BASELINE,
  collectFeatureShapeBaseline,
  collectFeatureShapeFindings,
  formatBaseline,
  lintFeatureShape,
  type ClassifiedPackage,
  type FeatureCatalogueEntry,
} from "../src/index.ts";
import { snapshotOf } from "./workspace.ts";

let root = "";
const catalogue: FeatureCatalogueEntry[] = [
  { id: "widget", root: "modules/widget", classification: "core", subjects: ["widget"] },
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

function pkg(kind: "contract" | "server" | "web", feature = "widget"): ClassifiedPackage {
  const featureRoot = join(root, `modules/${feature}`);
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
  write("modules/widget/contract/src/widget.api.ts");
  write("modules/widget/server/src/widget.server.ts");
  write("modules/widget/server/src/app/widget.app.ts");
  write("modules/widget/server/src/app/__tests__/widget.fixture.ts");
  write("modules/widget/server/src/services/widget.service.ts");
  write("modules/widget/server/src/repositories/widget.repository.ts");
  write("modules/widget/server/src/repositories/widget-repositories.registry.ts");
  write("modules/widget/server/src/repositories/prisma/prisma.widget.repository.ts");
  write("modules/widget/server/src/repositories/memory/memory.widget.repository.ts");
  write("modules/widget/server/src/repositories/__tests__/widget.repository.contract.test.ts");
  write("modules/widget/server/src/transport/widget.rest.ts");
  write("modules/widget/server/src/transport/widget.trpc.ts");
  write("modules/widget/web/src/widgets.ts");
  write(
    "apps/api/src/features/widget/widget.composition.ts",
    'createApp().withModules([withMemoryRepositories(widgetServer)]).boot();\n',
  );
}

function everyPackage(): ClassifiedPackage[] {
  return [pkg("contract"), pkg("server"), pkg("web")];
}

function findings() {
  return collectFeatureShapeFindings(root, catalogue, everyPackage());
}

function violations() {
  return lintFeatureShape(snapshotOf({ root, catalogue, packages: everyPackage() }));
}

/** Rows keyed `<feature>|<kind>`, sorted the way the reader validates them. */
function baseline(pieces: readonly { feature: string; kind: string }[]): void {
  const entries = pieces
    .map((piece) => ({ key: `${piece.feature}|${piece.kind}`, measured: "2026-09-08" }))
    .sort((a, b) => (a.key === b.key ? 0 : a.key < b.key ? -1 : 1));

  write(
    "packages/architecture-lint/src/feature-shape-baseline.json",
    JSON.stringify({ version: 1, policy: "feature-shape", entries }),
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
      write("modules/widget/contract/src/widget.service.ts");
      write("modules/widget/server/src/adapters/postgres.widget.adapter.ts");
      write("modules/widget/server/src/fixtures/widget.fixture.ts");
      write("modules/widget/server/src/testing.ts");
      write(
        "modules/widget/server/src/transport/api-trpc/widget.api.ts",
        "export const widgetApi = createTrpcService({ name: 'widget' });\n",
      );
    });

    /** @scenario "A pre-reference feature shape is inventoried, never admitted" */
    it("names every legacy piece once, with the path that carries it", () => {
      expect(findings()).toEqual([
        {
          feature: "widget",
          kind: "contract-service",
          path: "modules/widget/contract/src/widget.service.ts",
        },
        {
          feature: "widget",
          kind: "fixtures-directory",
          path: "modules/widget/server/src/fixtures",
        },
        {
          feature: "widget",
          kind: "legacy-transport-runtime",
          path: "modules/widget/server/src/transport/api-trpc/widget.api.ts",
        },
        {
          feature: "widget",
          kind: "nested-transport",
          path: "modules/widget/server/src/transport/api-trpc",
        },
        {
          feature: "widget",
          kind: "persistence-adapter",
          path: "modules/widget/server/src/adapters/postgres.widget.adapter.ts",
        },
        {
          feature: "widget",
          kind: "testing-entry",
          path: "modules/widget/server/src/testing.ts",
        },
      ]);
    });

    /** @scenario "A pre-reference feature shape is inventoried, never admitted" */
    it("rejects each piece that the baseline does not list, pointing at the reference shape", () => {
      const rejected = violations().filter((violation) => violation.policy === "feature-shape");

      expect(rejected).toHaveLength(6);
      expect(rejected.map((violation) => violation.allowed)).toEqual(
        expect.arrayContaining([expect.stringContaining("defineTrpcRouter")]),
      );
    });

    it("admits exactly the listed pieces", () => {
      baseline([
        { feature: "widget", kind: "contract-service" },
        { feature: "widget", kind: "fixtures-directory" },
        { feature: "widget", kind: "legacy-transport-runtime" },
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
        { feature: "widget", kind: "legacy-transport-runtime" },
        { feature: "widget", kind: "nested-transport" },
        { feature: "widget", kind: "persistence-adapter" },
        { feature: "widget", kind: "testing-entry" },
      ]);
      rmSync(join(root, "modules/widget/server/src/testing.ts"));

      expect(violations()).toMatchObject([
        {
          policy: "feature-shape-baseline",
          message: expect.stringContaining("widget/testing-entry"),
        },
      ]);
    });

    /** @scenario "A collected baseline keeps the date an existing row carries" */
    it("collects and formats the inventory as one sorted row per feature and kind", () => {
      const entries = collectFeatureShapeBaseline({
        root,
        catalogue,
        packages: everyPackage(),
        previous: [{ key: "widget|nested-transport", measured: "2020-01-01" }],
      });

      expect(entries.map((entry) => entry.key)).toEqual([
        "widget|contract-service",
        "widget|fixtures-directory",
        "widget|legacy-transport-runtime",
        "widget|nested-transport",
        "widget|persistence-adapter",
        "widget|testing-entry",
      ]);
      expect(entries[3]?.measured).toBe("2020-01-01");
      expect(formatBaseline({ policy: FEATURE_SHAPE_BASELINE, entries })).toBe(
        `${JSON.stringify({ version: 1, policy: "feature-shape", entries }, null, 2)}\n`,
      );
    });
  });

  describe("given a flat transport that still names a legacy builder", () => {
    /** @scenario "A pre-reference feature shape is inventoried, never admitted" */
    it("reports the family as running on the legacy runtime, naming the file", () => {
      referenceFeature();
      write(
        "modules/widget/server/src/transport/widget.rest.ts",
        'const { service } = security.createVersionedApp({ name: "widgets" });\n',
      );

      expect(findings()).toEqual([
        {
          feature: "widget",
          kind: "legacy-transport-runtime",
          path: "modules/widget/server/src/transport/widget.rest.ts",
        },
      ]);
    });
  });

  describe("given a channels folder", () => {
    /** @scenario "A channels folder without a registry is conversion debt" */
    it("asks for a registry when channels are not selected by one", () => {
      referenceFeature();
      write("modules/widget/server/src/channels/webhook.channel.ts");
      write("modules/widget/server/src/channels/memory/memory.webhook.channel.ts");

      expect(findings()).toEqual([
        {
          feature: "widget",
          kind: "unregistered-channels",
          path: "modules/widget/server/src/channels",
        },
      ]);
    });

    /** @scenario "A live channel without a memory twin is conversion debt" */
    it("asks for a memory twin when only a live tier exists", () => {
      referenceFeature();
      write("modules/widget/server/src/channels/webhook.channel.ts");
      write("modules/widget/server/src/channels/widget-channels.registry.ts");
      write("modules/widget/server/src/channels/http/http.webhook.channel.ts");

      expect(findings()).toEqual([
        {
          feature: "widget",
          kind: "unregistered-channels",
          path: "modules/widget/server/src/channels/http",
        },
      ]);
    });
  });

  describe("given a repositories folder without the reference's selection", () => {
    it("asks for a registry when repositories are not selected by one", () => {
      referenceFeature();
      rmSync(join(root, "modules/widget/server/src/repositories/widget-repositories.registry.ts"));

      expect(findings().map((finding) => finding.kind)).toEqual(["unregistered-repositories"]);
    });

    it("asks for a contract test when nothing runs the memory twin against Prisma", () => {
      referenceFeature();
      rmSync(
        join(
          root,
          "modules/widget/server/src/repositories/__tests__/widget.repository.contract.test.ts",
        ),
      );

      expect(findings().map((finding) => finding.kind)).toEqual(["memory-twin-untested"]);
    });

    it("asks for the memory twin when only Prisma repositories exist", () => {
      referenceFeature();
      rmSync(join(root, "modules/widget/server/src/repositories/memory"), {
        recursive: true,
      });

      expect(findings().map((finding) => finding.kind)).toEqual(["postgres-without-memory"]);
    });
  });

  describe("given a feature that lacks a piece of the reference", () => {
    it("asks for the installer when no <feature>.server.ts exists", () => {
      referenceFeature();
      rmSync(join(root, "modules/widget/server/src/widget.server.ts"));

      expect(findings().map((finding) => finding.kind)).toEqual(["no-installer"]);
    });

    it("asks for the one app when no app/<feature>.app.ts exists", () => {
      referenceFeature();
      rmSync(join(root, "modules/widget/server/src/app/widget.app.ts"));

      expect(findings().map((finding) => finding.kind)).toEqual(["no-app"]);
    });

    /** @scenario "A pre-reference feature shape is inventoried, never admitted" */
    it("reports an installer no process boots, naming the installer file", () => {
      referenceFeature();
      rmSync(join(root, "apps/api/src/features/widget/widget.composition.ts"));

      expect(findings()).toEqual([
        {
          feature: "widget",
          kind: "installer-not-booted",
          path: "modules/widget/server/src/widget.server.ts",
        },
      ]);
    });

    it("accepts a worker-side installer named after the feature", () => {
      referenceFeature();
      write(
        "apps/api/src/features/widget/widget.composition.ts",
        'createApp().withModules([withMemoryRepositories(workerWidgetServer)]).boot();\n',
      );

      expect(findings()).toEqual([]);
    });

    it("reports a refusing twin beside the feature's composition", () => {
      referenceFeature();
      write(
        "apps/api/src/features/widget/widget-absence.ts",
        "export function refusingWidgetFeature() {}\n",
      );

      expect(findings()).toEqual([
        {
          feature: "widget",
          kind: "refusing-composition",
          path: "apps/api/src/features/widget/widget-absence.ts",
        },
      ]);
    });

    it("reports web entries still nested under screens/ or surfaces/", () => {
      referenceFeature();
      write("modules/widget/web/src/screens/widgets/index.ts");
      write("modules/widget/web/src/surfaces");

      expect(findings()).toEqual([
        {
          feature: "widget",
          kind: "nested-web-entry",
          path: "modules/widget/web/src/screens",
        },
      ]);
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

    /** @scenario "An out-of-order or duplicated file is refused before it is read" */
    it("refuses an unsorted or duplicated inventory", () => {
      referenceFeature();
      write("modules/widget/server/src/testing.ts");
      write("modules/widget/contract/src/widget.service.ts");
      write(
        "packages/architecture-lint/src/feature-shape-baseline.json",
        JSON.stringify({
          version: 1,
          policy: "feature-shape",
          entries: [
            { key: "widget|testing-entry", measured: "2026-09-08" },
            { key: "widget|contract-service", measured: "2026-09-08" },
          ],
        }),
      );

      expect(violations()).toMatchObject([
        { policy: "feature-shape-baseline", message: expect.stringContaining("sorted") },
      ]);
    });

    it("measures only catalogue features", () => {
      write("modules/other/server/src/testing.ts");

      expect(collectFeatureShapeFindings(root, catalogue, [pkg("server", "other")])).toEqual([]);
    });
  });
});
