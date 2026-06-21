import { describe, expect, it } from "vitest";

import { mergeOpenAPISpecs, type OpenAPISpec } from "../mergeOpenAPISpecs";

/**
 * Builds a minimal OpenAPI spec from a paths map, plus any extra top-level
 * fields (e.g. info/openapi) to assert base-spec passthrough.
 */
function buildSpec({
  paths = {},
  ...rest
}: {
  paths?: Record<string, unknown>;
  [key: string]: unknown;
}): OpenAPISpec {
  return { paths, ...rest };
}

describe("mergeOpenAPISpecs()", () => {
  describe("given an app-owned route was removed", () => {
    describe("when the current spec still has the orphan path", () => {
      it("prunes the orphan from the merged paths", () => {
        const currentSpec = buildSpec({
          paths: {
            "/api/prompts/{id}": { get: { summary: "get prompt" } },
            "/api/prompts/{id}/labels/{label}": {
              delete: { summary: "remove label" },
            },
          },
        });
        const promptsAppSpec = buildSpec({
          paths: {
            "/api/prompts/{id}": { get: { summary: "get prompt" } },
          },
        });

        const result = mergeOpenAPISpecs({
          currentSpec,
          appSpecs: [promptsAppSpec],
          baseSpec: buildSpec({}),
        });

        expect(result.paths).not.toHaveProperty(
          "/api/prompts/{id}/labels/{label}",
        );
        expect(result.paths).toHaveProperty("/api/prompts/{id}");
      });
    });
  });

  describe("given an app-owned route path param was renamed", () => {
    describe("when the current spec has the old param name", () => {
      it("drops the old path and keeps the renamed one", () => {
        const currentSpec = buildSpec({
          paths: {
            "/api/prompts/tags/{tagId}": { get: { summary: "by tagId" } },
          },
        });
        const promptsAppSpec = buildSpec({
          paths: {
            "/api/prompts/tags/{tag}": { get: { summary: "by tag" } },
          },
        });

        const result = mergeOpenAPISpecs({
          currentSpec,
          appSpecs: [promptsAppSpec],
          baseSpec: buildSpec({}),
        });

        expect(result.paths).not.toHaveProperty("/api/prompts/tags/{tagId}");
        expect(result.paths).toHaveProperty("/api/prompts/tags/{tag}");
      });
    });
  });

  describe("given an app-owned route still exists with changed details", () => {
    describe("when the current spec carries stale sub-keys for it", () => {
      it("replaces the path wholesale instead of deep-merging", () => {
        const currentSpec = buildSpec({
          paths: {
            "/api/prompts/{id}": {
              get: { summary: "old", deprecated: true },
            },
          },
        });
        const promptsAppSpec = buildSpec({
          paths: {
            "/api/prompts/{id}": { get: { summary: "new" } },
          },
        });

        const result = mergeOpenAPISpecs({
          currentSpec,
          appSpecs: [promptsAppSpec],
          baseSpec: buildSpec({}),
        });

        expect(result.paths!["/api/prompts/{id}"]).toEqual({
          get: { summary: "new" },
        });
      });
    });
  });

  describe("given a manual route lives in a namespace no app generates", () => {
    describe("when an app generates the plural sibling namespace", () => {
      it("preserves manual entries (/api/annotations, singular /api/trace) while refreshing the app-owned /api/traces", () => {
        const currentSpec = buildSpec({
          paths: {
            "/api/annotations": { get: { summary: "list annotations" } },
            "/api/trace/{id}": { get: { summary: "get single trace" } },
            "/api/traces/{id}": { get: { summary: "old traces" } },
          },
        });
        const tracesAppSpec = buildSpec({
          paths: {
            "/api/traces/{id}": { get: { summary: "new traces" } },
          },
        });

        const result = mergeOpenAPISpecs({
          currentSpec,
          appSpecs: [tracesAppSpec],
          baseSpec: buildSpec({}),
        });

        expect(result.paths!["/api/annotations"]).toEqual({
          get: { summary: "list annotations" },
        });
        expect(result.paths!["/api/trace/{id}"]).toEqual({
          get: { summary: "get single trace" },
        });
        expect(result.paths!["/api/traces/{id}"]).toEqual({
          get: { summary: "new traces" },
        });
      });
    });
  });

  describe("given a base spec with top-level metadata", () => {
    describe("when merging app specs onto the current spec", () => {
      it("carries the base spec's top-level fields onto the result", () => {
        const currentSpec = buildSpec({
          paths: { "/api/prompts/{id}": { get: { summary: "get prompt" } } },
        });
        const baseSpec = buildSpec({
          openapi: "3.1.0",
          info: { title: "LangWatch API", version: "1.0.0" },
        });

        const result = mergeOpenAPISpecs({
          currentSpec,
          appSpecs: [buildSpec({ paths: {} })],
          baseSpec,
        });

        expect(result.openapi).toBe("3.1.0");
        expect(result.info).toEqual({
          title: "LangWatch API",
          version: "1.0.0",
        });
      });
    });
  });

  describe("given appSpecs is empty", () => {
    describe("when the current spec has paths", () => {
      it("returns every current path unchanged (no namespace is owned)", () => {
        const currentSpec = buildSpec({
          paths: {
            "/api/prompts/{id}": { get: { summary: "keep" } },
            "/api/annotations": { get: { summary: "keep" } },
          },
        });

        const result = mergeOpenAPISpecs({
          currentSpec,
          appSpecs: [],
          baseSpec: buildSpec({}),
        });

        expect(result.paths).toEqual(currentSpec.paths);
      });
    });
  });

  describe("given an app stops emitting a namespace entirely", () => {
    describe("when no app spec contains any path under it", () => {
      it("preserves that namespace's committed paths instead of pruning them", () => {
        const currentSpec = buildSpec({
          paths: {
            "/api/legacy/foo": { get: { summary: "retired app" } },
            "/api/prompts/{id}": { get: { summary: "old" } },
          },
        });
        const promptsAppSpec = buildSpec({
          paths: { "/api/prompts/{id}": { get: { summary: "new" } } },
        });

        const result = mergeOpenAPISpecs({
          currentSpec,
          appSpecs: [promptsAppSpec],
          baseSpec: buildSpec({}),
        });

        expect(result.paths!["/api/legacy/foo"]).toEqual({
          get: { summary: "retired app" },
        });
      });
    });
  });

  describe("given a committed path has a single path segment", () => {
    describe("when apps only own /api/<namespace> paths", () => {
      it("keeps the single-segment path because its namespace is not app-owned", () => {
        const currentSpec = buildSpec({
          paths: {
            "/health": { get: { summary: "health check" } },
            "/api/prompts/{id}": { get: { summary: "old" } },
          },
        });
        const promptsAppSpec = buildSpec({
          paths: { "/api/prompts/{id}": { get: { summary: "new" } } },
        });

        const result = mergeOpenAPISpecs({
          currentSpec,
          appSpecs: [promptsAppSpec],
          baseSpec: buildSpec({}),
        });

        expect(result.paths!["/health"]).toEqual({
          get: { summary: "health check" },
        });
      });
    });
  });
});
