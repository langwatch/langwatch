/**
 * `GET /api/v1/traces/facets`: the discovery payload with no `field`, one
 * field's paged values with one - registered before `:traceId` so "facets"
 * is never read as a trace id.
 */
import { createApiFixture } from "@langwatch/api-fixture";
import {
  bindRestMiddleware,
  createRestRuntime,
  projectRestFacts,
  type RestErrorHandler,
} from "@langwatch/api/rest";
import { HandledError } from "@langwatch/handled-error";
import type { TopicApi } from "@langwatch/topic-contract";
import type { TraceListRead } from "@langwatch/trace-contract";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { describe, expect, it, vi } from "vitest";

import { createTraceAppHarness } from "../../app/__tests__/support/trace-app.harness.ts";
import type { TracesListReader } from "../../app/trace.app.ts";
import { CLICKHOUSE_FACET_CATALOG } from "../../repositories/clickhouse/clickhouse.trace-facet-registry.mapper.ts";
import { TraceFacetValuesService } from "../../services/trace-facet-values.service.ts";
import { TraceTopicNamingService } from "../../services/trace-topic-naming.service.ts";
import type { TraceViewerProtectionService } from "../../services/trace-viewer-protection.service.ts";
import { tracesRestCredential, tracesRest } from "../traces.rest.ts";

const boundaryErrorHandler: RestErrorHandler = (error, c) => {
  if (HandledError.isHandled(error)) {
    return c.json({ error: error.code }, (error.httpStatus ?? 500) as ContentfulStatusCode);
  }
  return c.json({ error: "internal_server_error" }, 500);
};

function mount(
  overrides: Readonly<{
    resolveApiKeyProtections?: TraceViewerProtectionService["resolveForApiKey"];
  }> = {},
) {
  const readDiscover = vi.fn<TracesListReader["getDiscover"]>(async () => ({
    facets: [],
    pending: false,
  }));
  const readFacetValues = vi.fn<TracesListReader["getFacetValues"]>(async () => ({
    values: [{ value: "gpt-5-mini", count: 3 }],
    totalDistinct: 1,
  }));
  const facetValues = TraceFacetValuesService.create({
    repository: createApiFixture<TraceListRead>({}, "list repository"),
    topicNaming: TraceTopicNamingService.create({
      topicService: createApiFixture<TopicApi>({}, "topics"),
    }),
    facets: CLICKHOUSE_FACET_CATALOG,
  });

  const stub = createTraceAppHarness({
    protections: createApiFixture<TraceViewerProtectionService>({
      resolveForApiKey:
        overrides.resolveApiKeyProtections ??
        (async () => ({ canSeeCapturedInput: true, canSeeCapturedOutput: true })),
    }),
    traces: {
      list: createApiFixture<TracesListReader>({
        getDiscover: readDiscover,
        getFacetValues: readFacetValues,
        resolveFacetKey: (input) => facetValues.resolveFacetKey(input),
      }),
    },
  });

  const runtime = createRestRuntime({
    identity: {
      authenticate: () => ({
        actor: { type: "user" as const, id: "user-1" },
        scope: { tier: "project" as const, id: "project-1" },
      }),
    },
  });

  const hono = runtime.mount(tracesRest.router(), {
    app: () => stub,
    credential: "project",
    onError: boundaryErrorHandler,
    facts: [
      bindRestMiddleware(projectRestFacts, () => ({
        projectSlug: "project-one",
        viewerUserId: null,
        actorId: "user-1",
      })),
      bindRestMiddleware(tracesRestCredential, () => ({ apiKeyId: null, userId: "user-1" })),
    ],
  });

  const send = (path: string) => hono.request(`http://api.test${path}`, { method: "GET" });

  return { send, readDiscover, readFacetValues };
}

describe("GET /api/v1/traces/facets", () => {
  describe("when no field is named", () => {
    it("answers the tenant's discovery payload for the default window", async () => {
      const { send, readDiscover } = mount();

      const response = await send("/api/v1/traces/facets");

      expect(response.status).toBe(200);
      expect(readDiscover).toHaveBeenCalledWith({
        tenantId: "project-1",
        timeRange: expect.objectContaining({ from: expect.any(Number), to: expect.any(Number) }),
      });
      await expect(response.json()).resolves.toEqual({ facets: [], pending: false });
    });
  });

  describe("when a registry field is named", () => {
    it("pages that field's values and reports whether more remain", async () => {
      const { send, readFacetValues } = mount();

      const response = await send("/api/v1/traces/facets?field=model&limit=1&offset=0");

      expect(response.status).toBe(200);
      expect(readFacetValues).toHaveBeenCalledWith(
        expect.objectContaining({ tenantId: "project-1", facetKey: "model", limit: 1, offset: 0 }),
      );
      await expect(response.json()).resolves.toEqual({
        values: [{ value: "gpt-5-mini", count: 3 }],
        total: 1,
        hasMore: false,
      });
    });
  });

  describe("when the field names no facet with values to list", () => {
    it("answers 422 naming the field", async () => {
      const { send, readFacetValues } = mount();

      const response = await send("/api/v1/traces/facets?field=not-a-real-facet");

      expect(response.status).toBe(422);
      expect(readFacetValues).not.toHaveBeenCalled();
    });
  });

  describe("when the field is an attribute key and the caller cannot read captured content", () => {
    it("answers 403 rather than the values behind it", async () => {
      const { send, readFacetValues } = mount({
        resolveApiKeyProtections: vi.fn(async () => ({
          canSeeCapturedInput: false,
          canSeeCapturedOutput: false,
        })),
      });

      const response = await send("/api/v1/traces/facets?field=trace.attribute.foo");

      expect(response.status).toBe(403);
      await expect(response.json()).resolves.toMatchObject({
        error: "trace_attribute_values_withheld",
      });
      expect(readFacetValues).not.toHaveBeenCalled();
    });
  });

  describe("given the route order against :traceId", () => {
    it("reads facets rather than treating the literal segment as a trace id", async () => {
      const { send, readDiscover } = mount();

      await send("/api/v1/traces/facets");

      expect(readDiscover).toHaveBeenCalled();
    });
  });
});
