/**
 * The drift check between the frozen OpenAPI document and what the installed
 * declarations publish.
 *
 * Spec: specs/api-reference/openapi-document-drift.feature.
 */
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { describe, expect, it } from "vitest";

import type { DeclaredRestFamily } from "../openapi-document.declarations.ts";
import {
  checkOpenApiDocument,
  renderDriftReport,
  type OpenApiDriftReport,
} from "../openapi-document.checker.ts";
import { hiddenRouteFamily, projectFamily } from "./openapi-document.fixture.ts";

/** A frozen document holding exactly the operations the caller names. */
async function frozenDocument(operations: Record<string, unknown>): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "openapi-frozen-"));
  const path = join(directory, "frozen.json");
  const paths: Record<string, Record<string, unknown>> = {};

  for (const [operationKey, operation] of Object.entries(operations)) {
    const separator = operationKey.indexOf(" ");
    const routePath = operationKey.slice(separator + 1);

    paths[routePath] = {
      ...paths[routePath],
      [operationKey.slice(0, separator).toLowerCase()]: operation,
    };
  }

  await writeFile(path, JSON.stringify({ openapi: "3.1.0", paths }), "utf8");

  return path;
}

async function check({
  families,
  frozenPath,
  baseline = [],
}: {
  families: readonly DeclaredRestFamily[];
  frozenPath: string;
  baseline?: readonly string[];
}): Promise<OpenApiDriftReport> {
  const directory = await mkdtemp(join(tmpdir(), "openapi-scratch-"));

  return checkOpenApiDocument({
    scratchPath: join(directory, "document.json"),
    families,
    frozenPath,
    baseline,
  });
}

describe("given a frozen document listing an operation no declaration publishes", () => {
  describe("when the check runs", () => {
    /** @scenario "A documented operation with no declaration behind it is reported as removed" */
    it("reports the operation as removed", async () => {
      const report = await check({
        families: [projectFamily],
        frozenPath: await frozenDocument({ "GET /api/v1/gadgets": { operationId: "listGadgets" } }),
      });

      expect(report.removed).toEqual(["GET /api/v1/gadgets"]);
    });

    /** @scenario "A documented operation with no declaration behind it is reported as removed" */
    it("counts it as a regression, which is what fails the run", async () => {
      const report = await check({
        families: [projectFamily],
        frozenPath: await frozenDocument({ "GET /api/v1/gadgets": { operationId: "listGadgets" } }),
      });

      expect(report.regressions).toEqual(["GET /api/v1/gadgets"]);
    });

    /** @scenario "A removal already at the baseline is inherited, not caused" */
    it("holds it against the baseline instead when the baseline names it", async () => {
      const report = await check({
        families: [projectFamily],
        frozenPath: await frozenDocument({ "GET /api/v1/gadgets": { operationId: "listGadgets" } }),
        baseline: ["GET /api/v1/gadgets"],
      });

      expect(report.regressions).toEqual([]);
      expect(report.baselined).toEqual(["GET /api/v1/gadgets"]);
    });

    /** @scenario "The checker writes only its scratch file" */
    it("leaves the frozen document byte-for-byte unchanged", async () => {
      const frozenPath = await frozenDocument({
        "GET /api/v1/gadgets": { operationId: "listGadgets" },
      });
      const before = await readFile(frozenPath, "utf8");

      await check({ families: [projectFamily], frozenPath });

      expect(await readFile(frozenPath, "utf8")).toBe(before);
    });
  });
});

describe("given a declaration publishing an operation the frozen document omits", () => {
  describe("when the check runs", () => {
    /** @scenario "A declared operation the document omits is reported and does not fail" */
    it("reports the operation as added and fails nothing", async () => {
      const report = await check({
        families: [projectFamily],
        frozenPath: await frozenDocument({}),
      });

      expect(report.added).toContain("POST /api/v1/widgets");
      expect(report.regressions).toEqual([]);
    });
  });
});

describe("given a frozen document describing by hand a route its declaration hides", () => {
  describe("when the check runs", () => {
    /** @scenario "A documented operation whose declaration hides it is not a removal" */
    it("reports it as declared and undescribed rather than as removed", async () => {
      const report = await check({
        families: [hiddenRouteFamily],
        frozenPath: await frozenDocument({
          "GET /api/v1/legacy/retired": { operationId: "readRetired" },
        }),
      });

      expect(report.undescribed).toEqual(["GET /api/v1/legacy/retired"]);
      expect(report.removed).toEqual([]);
    });
  });
});

describe("given an operation whose enforced credential moved", () => {
  describe("when the check runs", () => {
    /** @scenario "An operation whose enforced credential moved is reported as changed" */
    it("reports both requirements", async () => {
      const report = await check({
        families: [projectFamily],
        frozenPath: await frozenDocument({
          "GET /api/v1/widgets": { security: [{ admin_api_key: [] }] },
        }),
      });

      expect(report.changed).toEqual([
        {
          operation: "GET /api/v1/widgets",
          documented: JSON.stringify([{ admin_api_key: [] }]),
          served: JSON.stringify([{ project_api_key: [] }]),
        },
      ]);
    });
  });
});

describe("given a drift report", () => {
  describe("when it is rendered for a terminal", () => {
    /** @scenario "The rendered report names every operation the run would fail on" */
    it("names every operation the run would fail on", async () => {
      const report = await check({
        families: [projectFamily],
        frozenPath: await frozenDocument({ "GET /api/v1/gadgets": { operationId: "listGadgets" } }),
      });

      expect(renderDriftReport(report)).toContain("- GET /api/v1/gadgets");
    });
  });
});
