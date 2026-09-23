import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  collectFeatureShapeFindings,
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
  generatedModuleList();
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function write(path: string, content = "export {};\n"): void {
  const absolute = join(root, path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, content, "utf8");
}

function pkg(kind: "contract" | "process" | "browser", feature = "widget"): ClassifiedPackage {
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
    subjects: [feature],
    enterprise: false,
  };
}

/** The generated module list a real process installs from; see generate-modules.mjs. */
function generatedModuleList(identifiers: readonly string[] = []): void {
  write(
    "packages/installed-server-modules/src/server-modules.generated.ts",
    `export const serverModules = [${identifiers.join(", ")}] as const;\n`,
  );
}

/** The annotation reference shape, reduced to the paths the policy reads. */
function referenceFeature(): void {
  generatedModuleList(["widgetServer"]);
  write("modules/widget/contract/src/widget.api.ts");
  write("modules/widget/process/src/widget.server.ts");
  write("modules/widget/process/src/app/widget.app.ts");
  write("modules/widget/process/src/app/__tests__/widget.fixture.ts");
  write("modules/widget/process/src/services/widget.service.ts");
  write("modules/widget/process/src/repositories/widget.repository.ts");
  write("modules/widget/process/src/repositories/widget-repositories.registry.ts");
  write("modules/widget/process/src/repositories/prisma/prisma.widget.repository.ts");
  write("modules/widget/process/src/repositories/memory/memory.widget.repository.ts");
  write("modules/widget/process/src/repositories/__tests__/widget.repository.contract.test.ts");
  write("modules/widget/process/src/transport/widget.rest.ts");
  write("modules/widget/process/src/transport/widget.trpc.ts");
  write("modules/widget/browser/src/widgets.ts");
  write(
    "apps/api/src/features/widget/widget.composition.ts",
    "createApp().withModules([withMemoryRepositories(widgetServer)]).boot();\n",
  );
}

function everyPackage(): ClassifiedPackage[] {
  return [pkg("contract"), pkg("process"), pkg("browser")];
}

function findings() {
  return collectFeatureShapeFindings(root, catalogue, everyPackage());
}

function violations() {
  return lintFeatureShape(snapshotOf({ root, catalogue, packages: everyPackage() }));
}

describe("feature shape", () => {
  describe("given a feature laid out like the annotation reference", () => {
    /** @scenario "A pre-reference feature shape is reported, never admitted" */
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
      write("modules/widget/process/src/adapters/postgres.widget.adapter.ts");
      write("modules/widget/process/src/fixtures/widget.fixture.ts");
      write("modules/widget/process/src/testing.ts");
      write(
        "modules/widget/process/src/transport/api-trpc/widget.api.ts",
        "export const widgetApi = createTrpcService({ name: 'widget' });\n",
      );
    });

    /** @scenario "A pre-reference feature shape is reported, never admitted" */
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
          path: "modules/widget/process/src/fixtures",
        },
        {
          feature: "widget",
          kind: "legacy-transport-runtime",
          path: "modules/widget/process/src/transport/api-trpc/widget.api.ts",
        },
        {
          feature: "widget",
          kind: "nested-transport",
          path: "modules/widget/process/src/transport/api-trpc",
        },
        {
          feature: "widget",
          kind: "persistence-adapter",
          path: "modules/widget/process/src/adapters/postgres.widget.adapter.ts",
        },
        {
          feature: "widget",
          kind: "testing-entry",
          path: "modules/widget/process/src/testing.ts",
        },
      ]);
    });

    /** @scenario "A pre-reference feature shape is reported, never admitted" */
    it("rejects each piece, pointing at the reference shape", () => {
      const rejected = violations().filter((violation) => violation.policy === "feature-shape");

      expect(rejected).toHaveLength(6);
      expect(rejected.map((violation) => violation.allowed)).toEqual(
        expect.arrayContaining([expect.stringContaining("defineTrpcRouter")]),
      );
    });
  });

  describe("given a flat transport that still names a legacy builder", () => {
    /** @scenario "A pre-reference feature shape is reported, never admitted" */
    it("reports the family as running on the legacy runtime, naming the file", () => {
      referenceFeature();
      write(
        "modules/widget/process/src/transport/widget.rest.ts",
        'const { service } = security.createVersionedApp({ name: "widgets" });\n',
      );

      expect(findings()).toEqual([
        {
          feature: "widget",
          kind: "legacy-transport-runtime",
          path: "modules/widget/process/src/transport/widget.rest.ts",
        },
      ]);
    });
  });

  describe("given a channels folder", () => {
    /** @scenario "A channels folder without a registry is conversion debt" */
    it("asks for a registry when channels are not selected by one", () => {
      referenceFeature();
      write("modules/widget/process/src/channels/webhook.channel.ts");
      write("modules/widget/process/src/channels/memory/memory.webhook.channel.ts");

      expect(findings()).toEqual([
        {
          feature: "widget",
          kind: "unregistered-channels",
          path: "modules/widget/process/src/channels",
        },
      ]);
    });

    /** @scenario "A live channel without a memory twin is conversion debt" */
    it("asks for a memory twin when only a live tier exists", () => {
      referenceFeature();
      write("modules/widget/process/src/channels/webhook.channel.ts");
      write("modules/widget/process/src/channels/widget-channels.registry.ts");
      write("modules/widget/process/src/channels/http/http.webhook.channel.ts");

      expect(findings()).toEqual([
        {
          feature: "widget",
          kind: "unregistered-channels",
          path: "modules/widget/process/src/channels/http",
        },
      ]);
    });
  });

  describe("given a repositories folder without the reference's selection", () => {
    it("asks for a registry when repositories are not selected by one", () => {
      referenceFeature();
      rmSync(join(root, "modules/widget/process/src/repositories/widget-repositories.registry.ts"));

      expect(findings().map((finding) => finding.kind)).toEqual(["unregistered-repositories"]);
    });

    it("asks for a contract test when nothing runs the memory twin against Prisma", () => {
      referenceFeature();
      rmSync(
        join(
          root,
          "modules/widget/process/src/repositories/__tests__/widget.repository.contract.test.ts",
        ),
      );

      expect(findings().map((finding) => finding.kind)).toEqual(["memory-twin-untested"]);
    });

    it("asks for the memory twin when only Prisma repositories exist", () => {
      referenceFeature();
      rmSync(join(root, "modules/widget/process/src/repositories/memory"), {
        recursive: true,
      });

      expect(findings().map((finding) => finding.kind)).toEqual(["postgres-without-memory"]);
    });
  });

  describe("given a feature that lacks a piece of the reference", () => {
    it("asks for the installer when no <feature>.server.ts exists", () => {
      referenceFeature();
      rmSync(join(root, "modules/widget/process/src/widget.server.ts"));

      expect(findings().map((finding) => finding.kind)).toEqual(["no-installer"]);
    });

    it("asks for the one app when no app/<feature>.app.ts exists", () => {
      referenceFeature();
      rmSync(join(root, "modules/widget/process/src/app/widget.app.ts"));

      expect(findings().map((finding) => finding.kind)).toEqual(["no-app"]);
    });

    /** @scenario "A pre-reference feature shape is reported, never admitted" */
    it("reports an installer the generated module list omits, naming the installer file", () => {
      referenceFeature();
      generatedModuleList([]);

      expect(findings()).toEqual([
        {
          feature: "widget",
          kind: "installer-not-booted",
          path: "modules/widget/process/src/widget.server.ts",
        },
      ]);
    });

    it("accepts a worker-side installer named after the feature", () => {
      referenceFeature();
      generatedModuleList(["workerWidgetServer"]);

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
      write("modules/widget/browser/src/screens/widgets/index.ts");
      write("modules/widget/browser/src/surfaces");

      expect(findings()).toEqual([
        {
          feature: "widget",
          kind: "nested-web-entry",
          path: "modules/widget/browser/src/screens",
        },
      ]);
    });
  });

  describe("given a feature the catalogue does not name", () => {
    it("measures only catalogue features", () => {
      write("modules/other/process/src/testing.ts");

      expect(collectFeatureShapeFindings(root, catalogue, [pkg("process", "other")])).toEqual([]);
    });
  });

  describe("given no generated server module list", () => {
    /** @scenario "A policy whose anchor file is gone refuses the run by name" */
    it("throws naming the policy and the list instead of reading every installer as booted", () => {
      referenceFeature();
      rmSync(join(root, "packages/installed-server-modules/src/server-modules.generated.ts"));

      expect(() => findings()).toThrow(
        "feature-shape: its anchor packages/installed-server-modules/src/server-modules.generated.ts does not exist",
      );
    });
  });
});
