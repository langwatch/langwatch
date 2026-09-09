import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  collectSourceFolderShapeBaseline,
  collectSourceFolderShapeFindings,
  formatBaseline,
  FOLDER_BUDGET,
  lintSourceFolderShape,
  SOURCE_FOLDER_SHAPE_BASELINE,
} from "../src/index.ts";
import { snapshotOf } from "./workspace.ts";

let root = "";

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "source-folder-shape-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function write(path: string, content = "export const value = 1;\n"): void {
  const absolute = join(root, path);
  mkdirSync(dirname(absolute), { recursive: true });
  writeFileSync(absolute, content, "utf8");
}

function fill(directory: string, count: number): void {
  for (let index = 0; index < count; index += 1) {
    write(`${directory}/part-${index}.ts`, "export const part = 1;\n".repeat(30));
  }
}

const BASELINE = "packages/architecture-lint/src/source-folder-shape-baseline.json";

/** Rows keyed `<kind>|<path>`, written the way the one writer writes them. */
function baselineText(keys: readonly string[]): string {
  return formatBaseline({
    policy: SOURCE_FOLDER_SHAPE_BASELINE,
    entries: keys.map((key) => ({ key, measured: "2026-09-08" })),
  });
}

describe("source folder shape", () => {
  describe("given a folder that holds more source files than the budget", () => {
    /** @scenario A crowded folder is refused with the instruction to fold or split */
    it("reports the folder with its count and tells the author where the code belongs", () => {
      fill("packages/widget/src/rules", FOLDER_BUDGET + 1);

      const findings = collectSourceFolderShapeFindings(root);

      expect(findings).toHaveLength(1);
      expect(findings[0]).toMatchObject({
        kind: "crowded-folder",
        path: "packages/widget/src/rules",
      });
      expect(findings[0]!.message).toContain(`${FOLDER_BUDGET + 1} source files`);
      expect(findings[0]!.allowed).toContain("split the folder, not the file");
    });

    it("counts only source files: tests, declarations and generated files do not crowd a folder", () => {
      fill("packages/widget/src/rules", FOLDER_BUDGET);
      write("packages/widget/src/rules/part-0.unit.test.ts");
      write("packages/widget/src/rules/shapes.d.ts");
      write("packages/widget/src/rules/table.generated.ts");
      write("packages/widget/src/rules/__tests__/deep.test.ts");

      expect(collectSourceFolderShapeFindings(root)).toEqual([]);
    });
  });

  describe("given a folder exactly at the budget", () => {
    it("reports nothing", () => {
      fill("packages/widget/src/rules", FOLDER_BUDGET);

      expect(collectSourceFolderShapeFindings(root)).toEqual([]);
    });
  });

  describe("given a small file read only by one neighbour", () => {
    /** @scenario A fragment of a neighbouring file is refused with the instruction to fold it in */
    it("reports the file as a paragraph of its reader", () => {
      write(
        "packages/widget/src/rules/pricing.ts",
        'import { rate } from "./rate.ts";\nexport const price = rate * 2;\n',
      );
      write("packages/widget/src/rules/rate.ts", "export const rate = 3;\n");

      const findings = collectSourceFolderShapeFindings(root);

      expect(findings).toHaveLength(1);
      expect(findings[0]).toMatchObject({
        kind: "fragment-file",
        path: "packages/widget/src/rules/rate.ts",
      });
      expect(findings[0]!.message).toContain("`pricing.ts` reads it");
      expect(findings[0]!.allowed).toContain("Move the code into the file that reads it");
    });

    it("names the barrel case when the only reader is the folder's index", () => {
      write("packages/widget/src/rules/index.ts", 'export { rate } from "./rate.ts";\n');
      write("packages/widget/src/rules/rate.ts", "export const rate = 3;\n");

      const [finding] = collectSourceFolderShapeFindings(root);

      expect(finding).toMatchObject({ kind: "fragment-file" });
      expect(finding!.message).toContain("exists only to be re-exported");
    });
  });

  describe("given a small file the feature grammar requires", () => {
    /** @scenario A mount file the feature grammar requires is never a fragment */
    it("leaves an installer and a process mount alone however short they are", () => {
      write(
        "modules/widget/server/src/widget.server.ts",
        "export const widgetServer = 1;\n",
      );
      write(
        "modules/widget/server/src/index.ts",
        'export { widgetServer } from "./widget.server.ts";\n',
      );
      write(
        "apps/api/src/features/widget/widget-trpc.mount.ts",
        "export const createWidgetTrpcRouter = 1;\n",
      );
      write(
        "apps/api/src/features/widget/widget.composition.ts",
        'import { createWidgetTrpcRouter } from "./widget-trpc.mount.ts";\nexport const c = createWidgetTrpcRouter;\n',
      );

      expect(collectSourceFolderShapeFindings(root)).toEqual([]);
    });
  });

  describe("given a small file its neighbour reads only for types", () => {
    it("leaves it alone, since a type import reads nothing at runtime", () => {
      write("packages/widget/src/rules/shapes.ts", "export type Shape = { id: string };\n");
      write(
        "packages/widget/src/rules/table.ts",
        'import type { Shape } from "./shapes.ts";\nexport const rows: Shape[] = [];\n'.repeat(12),
      );

      expect(collectSourceFolderShapeFindings(root)).toEqual([]);
    });
  });

  describe("given a small file that another folder or nobody reads", () => {
    it("leaves a file read from another folder alone", () => {
      write("packages/widget/src/rules/rate.ts", "export const rate = 3;\n");
      write(
        "packages/widget/src/services/pricing.service.ts",
        'import { rate } from "../rules/rate.ts";\nexport const price = rate;\n',
      );

      expect(collectSourceFolderShapeFindings(root)).toEqual([]);
    });

    it("leaves a file nobody imports relatively alone, since a package entry is read by name", () => {
      write("packages/widget/src/widget.api.ts", "export const widgetApi = 1;\n");

      expect(collectSourceFolderShapeFindings(root)).toEqual([]);
    });
  });

  describe("given a baseline", () => {
    /** @scenario A baselined finding is silent and a stale baseline entry is reported */
    it("silences listed findings and refuses an entry that no longer holds", () => {
      fill("packages/widget/src/rules", FOLDER_BUDGET + 1);
      write(
        BASELINE,
        baselineText([
          "crowded-folder|packages/widget/src/rules",
          "fragment-file|packages/widget/src/gone.ts",
        ]),
      );

      const violations = lintSourceFolderShape(snapshotOf({ root }));

      expect(violations.map((violation) => violation.policy)).toEqual([
        "source-folder-shape-baseline",
      ]);
      expect(violations[0]!.message).toContain(
        "packages/widget/src/gone.ts no longer matches anything",
      );
    });

    it("reports an unlisted finding under the policy name", () => {
      fill("packages/widget/src/rules", FOLDER_BUDGET + 1);
      write(BASELINE, baselineText([]));

      const policies = lintSourceFolderShape(snapshotOf({ root })).map((violation) => violation.policy);

      expect(policies).toContain("source-folder-shape");
      expect(policies).toContain("source-folder-shape-baseline");
    });

    /** @scenario "A collected baseline keeps the date an existing row carries" */
    it("collects the baseline as rows sorted by key in code-unit order", () => {
      fill("packages/widget/src/rules", FOLDER_BUDGET + 1);
      write(
        "packages/widget/src/app/pricing.ts",
        'import { rate } from "./rate.ts";\nexport const price = rate;\n',
      );
      write("packages/widget/src/app/rate.ts", "export const rate = 3;\n");

      const entries = collectSourceFolderShapeBaseline({
        root,
        previous: [{ key: "crowded-folder|packages/widget/src/rules", measured: "2020-01-01" }],
      });

      expect(entries).toEqual([
        { key: "crowded-folder|packages/widget/src/rules", measured: "2020-01-01" },
        { key: "fragment-file|packages/widget/src/app/rate.ts", measured: expect.any(String) },
      ]);
    });
  });
});
