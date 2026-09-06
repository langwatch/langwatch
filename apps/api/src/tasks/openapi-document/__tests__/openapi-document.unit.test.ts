/**
 * The OpenAPI describer and its drift check, driven through the real mount.
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
} from "../openapi-document.checker.ts";
import {
  atCanonicalPaths,
  generateOpenApiDocument,
  withUnstatedBodiesLeftUnstated,
  type AccessPolicyExtension,
  type GeneratedOpenApiDocument,
  type OpenApiDocument,
} from "../openapi-document.generator.ts";

/**
 * One path per REST family the process mounts, spelled the way the document spells it.
 */
const A_ROUTE_FROM_EVERY_MOUNTED_FAMILY = [
  "/api/v1/agent-cache/{name}",
  "/api/agents",
  "/api/v1/analytics",
  "/api/v1/api-keys",
  "/api/coding-agent/pull-request-usage",
  "/api/v1/dashboards",
  "/api/v1/dataset",
  "/api/v1/dspy/log_steps",
  "/api/v1/evaluations/batch/log_results",
  "/api/v1/evaluators",
  "/api/v1/experiment/init",
  "/api/v1/experiments",
  "/api/gateway/v1/budgets",
  "/api/v1/governance/ingestion-templates",
  "/api/v1/graphs",
  "/api/v1/groups",
  "/api/v1/guardrails/{evaluator}/evaluate",
  "/api/v1/me/project",
  "/api/v1/model-defaults",
  "/api/v1/model-providers",
  "/api/v1/monitors",
  "/api/v1/optimization/{workflowId}/{versionId}",
  "/api/v1/organization/2026-08-07/",
  "/api/v1/organizations",
  "/api/projects",
  "/api/v1/prompts",
  "/api/v1/role-bindings/2026-08-07/",
  "/api/v1/roles/2026-08-07/",
  "/api/v1/scenario-events",
  "/api/v1/scenarios",
  "/api/v1/scim-tokens/2026-08-07/",
  "/api/scim/v2/Users",
  "/api/secret",
  "/api/secrets",
  "/api/v1/simulation-runs",
  "/api/v1/suites",
  "/api/v1/teams",
  "/api/v1/traces/search",
  "/api/v1/trigger/slack",
  "/api/v1/triggers",
  "/api/v1/projects/{projectId}/analytics/charts",
  "/api/webhooks/v1/endpoints",
  "/api/v1/workflows",
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

    /** @scenario "The published document carries no boolean exclusive bound" */
    it("spells every exclusive bound the 3.1 way", () => {
      const booleanBounds: string[] = [];
      const walk = (node: unknown, path: string): void => {
        if (Array.isArray(node)) {
          node.forEach((child, index) => walk(child, `${path}[${index}]`));
          return;
        }
        if (typeof node !== "object" || node === null) return;
        for (const [key, value] of Object.entries(node)) {
          const isBound = key === "exclusiveMinimum" || key === "exclusiveMaximum";
          if (isBound && typeof value === "boolean") booleanBounds.push(`${path}.${key}`);
          walk(value, `${path}.${key}`);
        }
      };

      walk(generated.document, "$");

      expect(booleanBounds).toEqual([]);
    });

    /** @scenario "A described route is published at its canonical v1 address" */
    it("publishes a bare-mounted family under its /api/v1 address only", () => {
      const described = Object.keys(generated.document.paths ?? {});

      expect(described).toContain("/api/v1/prompts");
      expect(described).not.toContain("/api/prompts");
      expect(generated.operations).toContain("GET /api/v1/prompts");
    });

    /** @scenario "A path carrying its own version segment is published unchanged" */
    it("leaves a path that already names a version segment alone", () => {
      const described = Object.keys(generated.document.paths ?? {});

      expect(described).toContain("/api/scim/v2/Users");
      expect(described).toContain("/api/webhooks/v1/endpoints");
      expect(described).toContain("/api/gateway/v1/budgets");
      expect(described).not.toContain("/api/v1/scim/v2/Users");
    });

    /** @scenario "A family with no v1 twin keeps its bare address" */
    it("keeps the bare address of a family opted out of the alias", () => {
      const described = Object.keys(generated.document.paths ?? {});

      // Each of these opted out because its v1 address belongs to ANOTHER
      // family, so the bare path stays and the twin, where the document has
      // one, is that other family's operation rather than this one's alias.
      for (const path of [
        "/api/agents",
        "/api/secrets",
        "/api/projects",
        "/api/coding-agent/pull-request-usage",
      ]) {
        expect(described).toContain(path);
        const twin = generated.document.paths?.[`/api/v1${path.slice("/api".length)}`];
        if (!twin) continue;
        expect((twin.get as { operationId?: string } | undefined)?.operationId).not.toBe(
          (generated.document.paths?.[path]?.get as { operationId?: string } | undefined)
            ?.operationId,
        );
      }
    });

    /** @scenario "Two families cannot publish at one canonical address" */
    it("fails when a bare path publishes at an address another family declares", () => {
      expect(() =>
        atCanonicalPaths({
          paths: { "/api/prompts": { get: {} }, "/api/v1/prompts": { get: {} } },
        }),
      ).toThrow("/api/v1/prompts");
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
     * The same guard, over a frozen path this test OWNS. The assertion above proves the
     * checker did not write the real artifact.
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
        paths: { "/api/v1/prompts": { get: { security: [{ admin_api_key: [] }] } } },
      });

      const report = await checkOpenApiDocument({
        scratchPath: join(scratchDir, "check-changed.json"),
        frozenPath,
        baseline: [],
      });

      expect(report.changed).toEqual([
        {
          operation: "GET /api/v1/prompts",
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

describe("given routes that declare a media type and no schema", () => {
  describe("when the description is generated", () => {
    /** @scenario "A status with no schema is described without a body" */
    it("keeps the status and drops the media object that describes nothing", () => {
      const tags = generated.document.paths?.["/api/v1/prompts/tags"]?.post as {
        responses: Record<string, { description?: string; content?: Record<string, unknown> }>;
      };

      expect(tags.responses["200"]?.description).toBe("Success");
      expect(tags.responses["200"]?.content).toBeUndefined();
      expect(tags.responses["201"]?.content?.["application/json"]).toHaveProperty("schema");
    });

    /** @scenario "A body of unstated shape is not required" */
    it("keeps the media type a raw body names and stops calling it required", () => {
      const run = generated.document.paths?.["/api/v1/experiments/{slug}/run"]?.post as {
        requestBody: { required?: boolean; content: Record<string, unknown> };
      };

      expect(Object.keys(run.requestBody.content)).toEqual(["application/json"]);
      expect(run.requestBody.required).toBe(false);
    });

    /** @scenario "No published response describes a body it cannot name" */
    it("publishes no response media object without a schema", () => {
      const unnamed = unnamedResponseMediaObjects(generated.document.paths);

      expect(unnamed).toEqual([]);
    });
  });

  describe("when a schema is declared", () => {
    /** @scenario "A declared schema is left alone" */
    it("leaves a described body and a described status untouched", () => {
      const document: OpenApiDocument = {
        paths: {
          "/thing": {
            post: {
              requestBody: {
                required: true,
                content: { "application/json": { schema: { type: "object" } } },
              },
              responses: {
                "200": { description: "ok", content: { "application/json": { schema: {} } } },
              },
            },
          },
        },
      };

      expect(withUnstatedBodiesLeftUnstated(document)).toEqual(document);
    });

    /** @scenario "A body with one described media type stays required" */
    it("leaves a required body alone when any of its media types names a schema", () => {
      const document: OpenApiDocument = {
        paths: {
          "/thing": {
            post: {
              requestBody: {
                required: true,
                content: {
                  "application/json": { schema: { type: "object" } },
                  "text/csv": {},
                },
              },
              responses: { "200": { description: "ok" } },
            },
          },
        },
      };

      const stated = withUnstatedBodiesLeftUnstated(document).paths?.["/thing"]?.post as {
        requestBody: { required?: boolean; content: Record<string, unknown> };
      };

      expect(stated.requestBody.required).toBe(true);
      expect(Object.keys(stated.requestBody.content)).toEqual(["application/json", "text/csv"]);
    });

    /** @scenario "A status keeps the media types it did describe" */
    it("drops only the media types of one status that name no schema", () => {
      const document: OpenApiDocument = {
        paths: {
          "/thing": {
            get: {
              responses: {
                "200": {
                  description: "ok",
                  content: {
                    "application/json": { schema: { type: "string" } },
                    "text/event-stream": {},
                  },
                },
              },
            },
          },
        },
      };

      const responses = (
        withUnstatedBodiesLeftUnstated(document).paths?.["/thing"]?.get as {
          responses: Record<string, { content?: Record<string, unknown>; description?: string }>;
        }
      ).responses;

      expect(Object.keys(responses["200"]?.content ?? {})).toEqual(["application/json"]);
      expect(responses["200"]?.description).toBe("ok");
    });
  });
});

describe("given the access policy every mounted route declares", () => {
  describe("when the description is generated", () => {
    /** @scenario "Every published operation carries its access policy" */
    it("states an access policy on every published operation", () => {
      const withoutPolicy: string[] = [];
      const unknownKind: string[] = [];
      for (const { operationKey, policy } of publishedPolicies()) {
        if (!policy) {
          withoutPolicy.push(operationKey);
          continue;
        }
        if (!POLICY_KINDS.includes(policy.kind))
          unknownKind.push(`${operationKey}: ${policy.kind}`);
        expect(policy.credential.length).toBeGreaterThan(0);
      }

      expect(withoutPolicy).toEqual([]);
      expect(unknownKind).toEqual([]);
    });

    /** @scenario "An operation requiring a permission publishes the permission" */
    it("publishes the permission a route requires beside its credential class", () => {
      expect(policyOf("GET /api/v1/prompts")).toEqual({
        kind: "permission",
        credential: ["project_api_key"],
        permission: "prompts:view",
      });
      expect(policyOf("GET /api/v1/api-keys")).toEqual({
        kind: "permission",
        credential: ["organization_api_key"],
        permission: "organization:view",
      });
    });

    /** @scenario "An unauthenticated operation says it is public" */
    it("says a public route is public, and admits no credential", () => {
      expect(policyOf("GET /api/v1/evaluations/list")).toEqual({
        kind: "public",
        credential: ["none"],
      });
    });

    /**
     * @scenario "A handler gating on something other than a permission publishes an empty list"
     */
    it("publishes an empty permission list rather than omitting it", () => {
      const policy = policyOf("POST /api/v1/dataset/direct-upload");

      expect(policy?.kind).toBe("handlerManaged");
      expect(policy).toHaveProperty("permissions");
      expect(policy?.permissions).toEqual([]);
    });

    /** @scenario "A route reachable by two credentials names both" */
    it("names both credential classes a handler-managed route answers", () => {
      expect(policyOf("POST /api/v1/dataset/direct-upload")?.credential).toEqual([
        "project_api_key",
        "session",
      ]);
    });

    /** @scenario "The published policy carries data and nothing else" */
    it("publishes data only — no function, no closure, no reviewer prose", () => {
      const prose: string[] = [];
      const unserialisable: string[] = [];
      for (const { operationKey, policy } of publishedPolicies()) {
        if (!policy) continue;
        // A function, a closure or a class instance does not survive the
        // round trip; the reviewer's `reason` describes how a handler is
        // built and never belongs in a document a customer reads.
        const roundTripsCleanly =
          JSON.stringify(JSON.parse(JSON.stringify(policy))) === JSON.stringify(policy);
        if (!roundTripsCleanly) {
          unserialisable.push(operationKey);
        }
        const hasUnpublishedMember = Object.keys(policy).some(
          (member) => !PUBLISHED_POLICY_MEMBERS.includes(member),
        );
        if (hasUnpublishedMember) {
          prose.push(`${operationKey}: ${Object.keys(policy).join(", ")}`);
        }
      }

      expect(unserialisable).toEqual([]);
      expect(prose).toEqual([]);
    });
  });
});

/** The eight kinds a route may declare. */
const POLICY_KINDS = [
  "permission",
  "apiKeyPermission",
  "projectPermission",
  "teamPermission",
  "anyAuthenticated",
  "public",
  "internal",
  "handlerManaged",
] as const;

/** Every member the extension is allowed to publish. `reason` is not one. */
const PUBLISHED_POLICY_MEMBERS = ["kind", "credential", "permission", "param", "permissions"];

/** One response's media objects that publish no schema, as `METHOD path status media`. */
function unnamedMediaObjects(
  method: string,
  path: string,
  status: string,
  content: Record<string, { schema?: unknown }> | undefined,
): string[] {
  const unnamed: string[] = [];
  for (const [mediaType, media] of Object.entries(content ?? {})) {
    if (media?.schema === undefined) {
      unnamed.push(`${method.toUpperCase()} ${path} ${status} ${mediaType}`);
    }
  }
  return unnamed;
}

/** Every response media object across the document that publishes no schema. */
function unnamedResponseMediaObjects(paths: OpenApiDocument["paths"]): string[] {
  const unnamed: string[] = [];
  for (const [path, item] of Object.entries(paths ?? {})) {
    for (const [method, operation] of Object.entries(item)) {
      const responses = (
        operation as {
          responses?: Record<string, { content?: Record<string, { schema?: unknown }> }>;
        }
      ).responses;
      for (const [status, response] of Object.entries(responses ?? {})) {
        unnamed.push(...unnamedMediaObjects(method, path, status, response?.content));
      }
    }
  }
  return unnamed;
}

/** Every published operation's `x-access-policy`, keyed the way the registry keys it. */
function* publishedPolicies(): Generator<{
  operationKey: string;
  policy: AccessPolicyExtension | undefined;
}> {
  for (const [path, item] of Object.entries(generated.document.paths ?? {})) {
    for (const [method, operation] of Object.entries(item)) {
      if (!OPERATION_MEMBERS.includes(method)) continue;
      yield {
        operationKey: `${method.toUpperCase()} ${path}`,
        policy: (operation as { "x-access-policy"?: AccessPolicyExtension })["x-access-policy"],
      };
    }
  }
}

/** The Path Item members that are operations. */
const OPERATION_MEMBERS = ["get", "put", "post", "delete", "options", "head", "patch", "trace"];

/** One operation's published policy, by `METHOD /path`. */
function policyOf(operationKey: string): AccessPolicyExtension | undefined {
  for (const published of publishedPolicies()) {
    if (published.operationKey === operationKey) return published.policy;
  }
  return undefined;
}

/** Writes a stand-in frozen document and hands back its path. */
async function writeFrozen(document: OpenApiDocument): Promise<string> {
  const path = join(scratchDir, `frozen-${Math.random().toString(36).slice(2)}.json`);
  await writeFile(path, JSON.stringify(document), "utf8");
  return path;
}
