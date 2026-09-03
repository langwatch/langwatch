/**
 * The OpenAPI describer and its drift check, driven through the real mount.
 *
 * Nothing here is a fixture of the surface: every assertion runs
 * `generateOpenApiDocument` over the same `createApiProcessRestFeatures`
 * enumeration production composes, so a family that stops being mounted fails
 * here rather than being described by a list this file also owns.
 *
 * See specs/api-reference/openapi-document-drift.feature.
 */
import { createHash } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { beforeAll, describe, expect, it } from "vitest";

import {
  checkOpenApiDocument,
  FROZEN_DOCUMENT_PATH,
  UNSERVED_AT_BASELINE,
} from "../openapi-document.checker";
import {
  generateOpenApiDocument,
  type GeneratedOpenApiDocument,
  type OpenApiDocument,
} from "../openapi-document.generator";

/**
 * One path per REST family the process mounts, spelled the way the document
 * spells it.
 *
 * A representative rather than the whole table: the point of the assertion is
 * that the FAMILY is described, and a family contributes all of its routes or
 * none of them — it is one Hono app either mounted or left off. Forty-two
 * entries is also a list a person can read, where 287 operations is not.
 */
const A_ROUTE_FROM_EVERY_MOUNTED_FAMILY = [
  "/api/agent-cache/{name}",
  "/api/agents",
  "/api/analytics",
  "/api/api-keys",
  "/api/coding-agent/pull-request-usage",
  "/api/dashboards",
  "/api/dataset",
  "/api/dspy/log_steps",
  "/api/evaluations/batch/log_results",
  "/api/evaluators",
  "/api/experiment/init",
  "/api/experiments",
  "/api/gateway/v1/budgets",
  "/api/governance/ingestion-templates",
  "/api/graphs",
  "/api/groups",
  "/api/guardrails/{evaluator}/evaluate",
  "/api/me/project",
  "/api/model-defaults",
  "/api/model-providers",
  "/api/monitors",
  "/api/optimization/{workflowId}/{versionId}",
  "/api/organization/2026-08-07/",
  "/api/organizations",
  "/api/projects",
  "/api/prompts",
  "/api/role-bindings/2026-08-07/",
  "/api/roles/2026-08-07/",
  "/api/scenario-events",
  "/api/scenarios",
  "/api/scim-tokens/2026-08-07/",
  "/api/scim/v2/Users",
  "/api/secret",
  "/api/secrets",
  "/api/simulation-runs",
  "/api/suites",
  "/api/teams",
  "/api/traces/search",
  "/api/trigger/slack",
  "/api/triggers",
  "/api/v1/projects/{projectId}/analytics/charts",
  "/api/webhooks/v1/endpoints",
  "/api/workflows",
] as const;

let scratchDir: string;
let generated: GeneratedOpenApiDocument;

beforeAll(async () => {
  scratchDir = await mkdtemp(join(tmpdir(), "langwatch-openapi-"));
  generated = await generateOpenApiDocument({
    outputPath: join(scratchDir, "generated.json"),
  });
});

/** The frozen artifact's bytes, hashed so a comparison names no 2.7 MB blob. */
async function frozenDigest(): Promise<string> {
  return createHash("sha256")
    .update(await readFile(FROZEN_DOCUMENT_PATH))
    .digest("hex");
}

describe("given the REST surface the API process mounts", () => {
  describe("when the description is generated", () => {
    /** @scenario "Every mounted family contributes its operations" */
    it("emits an operation for every mounted family", () => {
      const described = Object.keys(generated.document.paths ?? {});

      expect(A_ROUTE_FROM_EVERY_MOUNTED_FAMILY.filter((path) => !described.includes(path))).toEqual(
        [],
      );
    });

    it("describes the whole surface in one pass, so a family cannot be counted twice", () => {
      const described = Object.keys(generated.document.paths ?? {});

      expect(new Set(described).size).toBe(described.length);
      expect(generated.operations.length).toBeGreaterThan(described.length);
    });

    it("gives every published operation a security requirement of its own", () => {
      const withoutSecurity: string[] = [];
      for (const [path, item] of Object.entries(generated.document.paths ?? {})) {
        for (const [method, operation] of Object.entries(item)) {
          const security = (operation as { security?: unknown }).security;
          if (!Array.isArray(security)) {
            withoutSecurity.push(`${method.toUpperCase()} ${path}`);
          }
        }
      }

      // An operation with no requirement of its own inherits the document-wide
      // `project_api_key` default, which is a claim about a credential nothing
      // may have enforced. That is the defect per-operation stamping exists to
      // remove, so the correct count is zero rather than "few".
      expect(withoutSecurity).toEqual([]);
    });

    /** @scenario "An operation no security scheme can express is left out and named" */
    it("leaves out an operation no security scheme can express, and names it", () => {
      const sessionOnly = generated.unpublishable.map(({ operation }) => operation);

      expect(sessionOnly).toContain("POST /api/export/scenario-runs/download");
      expect(generated.operations).not.toContain("POST /api/export/scenario-runs/download");
      for (const { because } of generated.unpublishable) {
        expect(because).toContain("no security scheme an API client can satisfy");
      }
    });

    /** @scenario "The generator writes only where the caller pointed it" */
    it("writes the description to the path the caller named", async () => {
      const outputPath = join(scratchDir, "named-by-the-caller.json");

      const result = await generateOpenApiDocument({ outputPath });

      expect(result.outputPath).toBe(outputPath);
      const written = JSON.parse(await readFile(outputPath, "utf8")) as OpenApiDocument;
      expect(Object.keys(written.paths ?? {})).toEqual(Object.keys(result.document.paths ?? {}));
    });
  });
});

describe("given the frozen document and the served surface", () => {
  describe("when the check runs", () => {
    /** @scenario "The checker writes only its scratch file" */
    it("leaves the frozen document byte-for-byte unchanged", async () => {
      const before = await frozenDigest();

      await checkOpenApiDocument({ scratchPath: join(scratchDir, "check-default.json") });

      expect(await frozenDigest()).toBe(before);
    });

    /**
     * The same guard, over a frozen path this test OWNS.
     *
     * The assertion above proves the checker did not write the real artifact.
     * This one proves it cannot write whatever it is pointed at either, which
     * is what a sabotage of `frozenPath` would exploit: a sentinel that is not
     * a document at all comes back identical, byte for byte.
     */
    it("does not write the frozen path it was given, whatever is there", async () => {
      const sentinelPath = join(scratchDir, "sentinel-frozen.json");
      const sentinel = JSON.stringify({ paths: { "/api/sentinel": { get: {} } } });
      await writeFile(sentinelPath, sentinel, "utf8");

      await checkOpenApiDocument({
        scratchPath: join(scratchDir, "check-sentinel.json"),
        frozenPath: sentinelPath,
        baseline: [],
      });

      expect(await readFile(sentinelPath, "utf8")).toBe(sentinel);
    });

    /** @scenario "A documented operation with no route behind it is reported as removed" */
    it("reports a documented operation the process serves no route for", async () => {
      const frozenPath = await writeFrozen({
        paths: { "/api/retired/thing": { get: { security: [{ project_api_key: [] }] } } },
      });

      const report = await checkOpenApiDocument({
        scratchPath: join(scratchDir, "check-removed.json"),
        frozenPath,
        baseline: [],
      });

      expect(report.removed).toContain("GET /api/retired/thing");
      expect(report.regressions).toContain("GET /api/retired/thing");
    });

    /** @scenario "A served operation the document omits is reported and does not fail" */
    it("reports a served and undocumented operation without calling it a regression", async () => {
      const frozenPath = await writeFrozen({ paths: {} });

      const report = await checkOpenApiDocument({
        scratchPath: join(scratchDir, "check-added.json"),
        frozenPath,
        baseline: [],
      });

      expect(report.added).toEqual(generated.operations);
      expect(report.removed).toEqual([]);
      expect(report.regressions).toEqual([]);
    });

    /** @scenario "A documented operation served by an undescribed route is not a removal" */
    it("separates a hand-documented route that still answers from one that is gone", async () => {
      // `/api/annotations` is mounted and carries no `describeRoute`, so the
      // frozen document describes it by hand and the generator cannot
      // reproduce it. Calling that a deletion would report a live endpoint as
      // broken.
      const frozenPath = await writeFrozen({
        paths: {
          "/api/annotations": { get: { security: [{ project_api_key: [] }] } },
          "/api/retired/thing": { get: { security: [{ project_api_key: [] }] } },
        },
      });

      const report = await checkOpenApiDocument({
        scratchPath: join(scratchDir, "check-undescribed.json"),
        frozenPath,
        baseline: [],
      });

      expect(report.undescribed).toEqual(["GET /api/annotations"]);
      expect(report.removed).toEqual(["GET /api/retired/thing"]);
    });

    /** @scenario "An operation whose enforced credential moved is reported as changed" */
    it("reports an operation whose published security requirement moved", async () => {
      const frozenPath = await writeFrozen({
        paths: { "/api/prompts": { get: { security: [{ admin_api_key: [] }] } } },
      });

      const report = await checkOpenApiDocument({
        scratchPath: join(scratchDir, "check-changed.json"),
        frozenPath,
        baseline: [],
      });

      expect(report.changed).toEqual([
        {
          operation: "GET /api/prompts",
          documented: JSON.stringify([{ admin_api_key: [] }]),
          served: JSON.stringify([{ project_api_key: [] }]),
        },
      ]);
    });

    it("passes today, with every unserved operation accounted for in the baseline", async () => {
      const report = await checkOpenApiDocument({
        scratchPath: join(scratchDir, "check-baseline.json"),
      });

      expect(report.regressions).toEqual([]);
      // Every baseline entry still has to be a real removal. An entry that
      // stopped applying — because the family was mounted again — must be
      // deleted from the list rather than left to make the guard weaker than
      // it reads.
      expect([...report.baselined].sort()).toEqual([...UNSERVED_AT_BASELINE].sort());
    });
  });
});

/** Writes a stand-in frozen document and hands back its path. */
async function writeFrozen(document: OpenApiDocument): Promise<string> {
  const path = join(scratchDir, `frozen-${Math.random().toString(36).slice(2)}.json`);
  await writeFile(path, JSON.stringify(document), "utf8");
  return path;
}
