/**
 * The v1 trace REST family — `/api/traces` — driven through the runtime's own
 * `mount`, over a `TraceApi` app double, rather than the full door-registry
 * composition (`trace-rest.integration.test.ts` owns that heavier shape).
 * @see modules/trace/server/src/transport/traces.rest.ts
 * @see specs/coding-agent/transcript-rest.feature
 */
// @vitest-environment node
import {
  bindRestMiddleware,
  type RestProjectIdentity,
  type RestResolvedProjectCredential,
} from "@langwatch/api/rest";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { Trace, TraceApi } from "@langwatch/trace-contract";
import { AmbiguousTraceIdPrefixError, type TraceApp } from "@langwatch/trace-server";
import { createTracesRest, tracesRestCredential } from "@langwatch/trace-server/api-rest/traces";
import { Hono } from "hono";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";

import { ApiRestObservabilityComposition } from "../../../app/api-rest-observability.composition.ts";
import { createApiRestRuntime, type ApiRestRuntime } from "../../../app-rest/api-rest.runtime.ts";
import { mountTracesRest, type ApiTracesRestOptions } from "../traces-rest.mount.ts";
import type { ApiTraceReadStackPort } from "../trace-read-stack.port.ts";

const PROJECT: RestProjectIdentity = {
  id: "project-1",
  name: "Acme",
  slug: "acme",
  teamId: "team-1",
  organizationId: "organization-1",
  isPersonal: false,
  ownerUserId: null,
};

function trace(overrides: Partial<Trace> = {}): Trace {
  return {
    trace_id: "trace-abc123",
    project_id: PROJECT.id,
    metadata: {},
    timestamps: { started_at: 1_700_000_000_000, inserted_at: 1_700_000_000_000, updated_at: 1_700_000_000_000 },
    spans: [],
    input: { value: "hi" },
    output: { value: "hello" },
    error: null,
    ...overrides,
  } as Trace;
}

describe("given a project credential on the traces door", () => {
  describe("when a caller asks for a trace by id and it exists", () => {
    it("answers with the trace, its evaluations and a deep link", async () => {
      const readTrace = vi.fn(async () => trace({ trace_id: "trace-abc123" }));
      const readEvaluations = vi.fn(async () => ({ "trace-abc123": [{ evaluator_id: "eval-1" }] }));
      const world = mountTraces({ app: { readTrace, readEvaluations } });

      const response = await world.send("/api/traces/trace-abc123");

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        trace_id: "trace-abc123",
        evaluations: [{ evaluator_id: "eval-1" }],
        platformUrl: "https://app.langwatch.test/acme/traces/trace-abc123",
      });
      expect(readTrace).toHaveBeenCalledWith(
        expect.objectContaining({ projectId: PROJECT.id, traceId: "trace-abc123", withEditOverlay: true }),
      );
    });
  });

  describe("when the trace the caller asked for does not exist", () => {
    it("answers 404 with trace_not_found", async () => {
      const world = mountTraces({ app: { readTrace: async () => undefined } });

      const response = await world.send("/api/traces/missing-trace");

      expect(response.status).toBe(404);
      expect(await errorCode(response)).toBe("trace_not_found");
    });
  });

  describe("when a trace id prefix matches more than one trace", () => {
    it("answers 409 with trace_id_ambiguous, naming the candidates", async () => {
      const world = mountTraces({
        app: {
          readTrace: async () => {
            throw new AmbiguousTraceIdPrefixError("abc123", ["trace-abc123a", "trace-abc123b"]);
          },
        },
      });

      const response = await world.send("/api/traces/abc123");

      expect(response.status).toBe(409);
      expect(await errorCode(response)).toBe("trace_id_ambiguous");
    });
  });

  describe("when a caller asks for a trace's coding-agent transcript and the process composed the join", () => {
    /** @scenario "transcript endpoint returns the derived transcript for a coding-agent trace" */
    it("answers with the derived transcript entries", async () => {
      const readTrace = vi.fn(async () => trace({ trace_id: "trace-abc123" }));
      const readCodingAgentTranscript = vi.fn(async () => ({
        agent: "claude-code",
        sessionId: "session-1",
        entries: [{ type: "tool_call", name: "read_file" }],
        totals: { modelCalls: 1, toolCalls: 1, tokens: 100, costUsd: 0.01 },
        subAgents: [],
      }));
      const world = mountTracesRouter({ app: { readTrace }, readCodingAgentTranscript });

      const response = await world.send("/api/traces/trace-abc123/transcript");

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({
        agent: "claude-code",
        entries: [{ type: "tool_call", name: "read_file" }],
      });
    });
  });

  describe("when a trace has no coding-agent content and the process composed the join", () => {
    /** @scenario "transcript endpoint answers empty for a trace without coding-agent content" */
    it("answers with an empty transcript rather than an error", async () => {
      const readTrace = vi.fn(async () => trace({ trace_id: "trace-abc123" }));
      const readCodingAgentTranscript = vi.fn(async () => ({
        agent: "",
        sessionId: null,
        entries: [],
        totals: { modelCalls: 0, toolCalls: 0, tokens: 0, costUsd: 0 },
        subAgents: [],
      }));
      const world = mountTracesRouter({ app: { readTrace }, readCodingAgentTranscript });

      const response = await world.send("/api/traces/trace-abc123/transcript");

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toMatchObject({ entries: [] });
    });
  });

  describe("when the process composed no coding-agent transcript join at all", () => {
    it("does not register the transcript route", async () => {
      const world = mountTraces({});

      const response = await world.send("/api/traces/trace-abc123/transcript");

      expect(response.status).toBe(404);
    });
  });

  describe("when a caller amends a trace's metadata and the process composed a command queue", () => {
    it("applies the amendment and answers the trace id", async () => {
      const updateTraceMetadata = vi.fn(async () => {});
      const world = mountTraces({ updateTraceMetadata });

      const response = await world.send("/api/traces/trace-abc123/metadata", {
        method: "PATCH",
        body: { metadata: { labels: ["reviewed"] } },
      });

      expect(response.status).toBe(200);
      await expect(response.json()).resolves.toEqual({ traceId: "trace-abc123" });
      expect(updateTraceMetadata).toHaveBeenCalledWith({
        projectId: PROJECT.id,
        traceId: "trace-abc123",
        metadata: { labels: ["reviewed"] },
      });
    });
  });

  describe("when the process composed no command queue for metadata amendments", () => {
    it("does not register the metadata route", async () => {
      const world = mountTraces({});

      const response = await world.send("/api/traces/trace-abc123/metadata", {
        method: "PATCH",
        body: { metadata: {} },
      });

      expect(response.status).toBe(404);
    });
  });

  describe("when a caller searches traces", () => {
    it("answers the streamed envelope of serialized traces and pagination", async () => {
      const listTraces = vi.fn(async () => ({
        groups: [[trace({ trace_id: "trace-search-1" })]],
        traceChecks: {},
        totalHits: 1,
        scrollId: "next-page",
      }));
      const world = mountTraces({ app: { listTraces } });

      const response = await world.send("/api/traces/search", {
        method: "POST",
        body: { startDate: 1_700_000_000_000, endDate: 1_700_000_100_000 },
      });

      expect(response.status).toBe(200);
      const body = (await response.json()) as {
        traces: Array<{ trace_id: string }>;
        pagination: { totalHits: number; scrollId: string };
      };
      expect(body.pagination).toEqual({ totalHits: 1, scrollId: "next-page" });
      expect(body.traces).toHaveLength(1);
      expect(body.traces[0]?.trace_id).toBe("trace-search-1");
    });
  });

  describe("when a caller's redactions are resolved for the request", () => {
    it("resolves protections from the caller's own credential and passes them to the read", async () => {
      const getApiKeyProtections = vi.fn(async () => ({
        canSeeCosts: true,
        canSeeCapturedInput: true,
        canSeeCapturedOutput: false,
      }));
      const readTrace = vi.fn(async () => trace());
      const readEvaluations = vi.fn(async () => ({}));
      const world = mountTraces({
        app: { readTrace, readEvaluations },
        credential: "apiKey",
        getApiKeyProtections,
      });

      const response = await world.send("/api/traces/trace-abc123");

      expect(response.status).toBe(200);

      expect(getApiKeyProtections).toHaveBeenCalledWith({
        projectId: PROJECT.id,
        credential: {
          kind: "apiKey",
          apiKeyId: "api-key-1",
          userId: "user-1",
          organizationId: "",
          projectId: PROJECT.id,
          teamId: "",
        },
      });
      expect(readTrace).toHaveBeenCalledWith(
        expect.objectContaining({
          protections: { canSeeCosts: true, canSeeCapturedInput: true, canSeeCapturedOutput: false },
        }),
      );
    });
  });

  describe("when the request carries no usable credential", () => {
    it("refuses with the door's own 401 and reads nothing", async () => {
      const readTrace = vi.fn();
      const world = mountTraces({ app: { readTrace }, credential: "refused" });

      const response = await world.send("/api/traces/trace-abc123");

      expect(response.status).toBe(401);
      expect(readTrace).not.toHaveBeenCalled();
    });
  });
});

// ---------------------------------------------------------------------------

/** The canonical error envelope's code, whichever body shape a family publishes. */
async function errorCode(response: Response): Promise<string | undefined> {
  const body = (await response.json()) as { code?: string; error?: string | { code?: string } };
  if (typeof body.code === "string") return body.code;
  if (typeof body.error === "string") return body.error;
  return body.error?.code;
}

/** The one project door every test in this file authenticates through. */
function buildTestRuntime(options: {
  credential?: "apiKey" | "legacyProjectKey" | "refused";
}): ApiRestRuntime {
  const errors = ApiRestObservabilityComposition.create().legacyErrorHandler;

  return createApiRestRuntime({
    projectCredential: () => {
      if (options.credential === "refused") {
        return Promise.resolve({
          ok: false as const,
          status: 401 as const,
          body: { error: "unauthenticated" },
        });
      }
      const resolved: RestResolvedProjectCredential =
        options.credential === "apiKey"
          ? {
              type: "apiKey",
              apiKeyId: "api-key-1",
              userId: "user-1",
              organizationId: PROJECT.organizationId,
              ingestSourceType: null,
              ingestionTemplateId: null,
              project: PROJECT,
            }
          : { type: "legacyProjectKey", project: PROJECT };

      return Promise.resolve({
        ok: true as const,
        project: { id: PROJECT.id },
        resolved,
        markUsed: () => {},
      });
    },
    organizationCredential: () => {
      throw new Error("This suite composed no organization credential door.");
    },
    organizationIdentity: () => {
      throw new Error("This suite composed no organization credential door.");
    },
    routeAuthorization: () => {
      throw new Error("This suite authorizes no route-scoped permission.");
    },
    errors,
  });
}

/** The family as this process serves it: through `mountTracesRest`, and no other way. */
function mountTraces(options: {
  app?: Partial<TraceApi>;
  updateTraceMetadata?: ApiTracesRestOptions["updateTraceMetadata"];
  credential?: "apiKey" | "legacyProjectKey" | "refused";
  getApiKeyProtections?: ApiTraceReadStackPort["getApiKeyProtections"];
}) {
  const runtime = buildTestRuntime(options);

  const traceReads: ApiTracesRestOptions = {
    traces: () => createApiFixture<TraceApi>(options.app ?? {}) as TraceApp,
    reads: {
      getApiKeyProtections:
        options.getApiKeyProtections ??
        (async () => ({ canSeeCosts: true, canSeeCapturedInput: true, canSeeCapturedOutput: true })),
    } as unknown as ApiTraceReadStackPort,
    platformUrl: ({ projectSlug, path }) => `https://app.langwatch.test/${projectSlug}${path}`,
    ...(options.updateTraceMetadata ? { updateTraceMetadata: options.updateTraceMetadata } : {}),
  };

  return sendableApp(mountTracesRest(runtime, traceReads));
}

/**
 * The bare router `createTracesRest` declares, mounted directly rather than
 * through `mountTracesRest` — this process's own mount names the coding-agent
 * transcript join a permanent absence (no canonical log read composed), so
 * the transcript route's success path is only reachable at the router itself.
 */
function mountTracesRouter(options: {
  app?: Partial<TraceApi>;
  readCodingAgentTranscript: NonNullable<
    Parameters<typeof createTracesRest>[0]["readCodingAgentTranscript"]
  >;
}) {
  const runtime = buildTestRuntime({});

  const declaration = createTracesRest({
    searchBodySchema: z.object({}),
    platformUrl: ({ projectSlug, path }) => `https://app.langwatch.test/${projectSlug}${path}`,
    getProtections: async () => ({}),
    readCodingAgentTranscript: options.readCodingAgentTranscript,
  });

  return sendableApp(
    runtime.mount(declaration.router(), () => createApiFixture<TraceApi>(options.app ?? {}), {
      facts: [bindRestMiddleware(tracesRestCredential, () => ({ apiKeyId: null, userId: null }))],
    }),
  );
}

/** Drives one request through a mounted family exactly as Hono serves it. */
function sendableApp(mounted: ReturnType<ApiRestRuntime["mount"]>) {
  const hono = new Hono().route("/", mounted);

  return {
    send: (path: string, init: { method?: string; body?: unknown } = {}) =>
      hono.fetch(
        new Request(`http://api.test${path}`, {
          method: init.method ?? "GET",
          headers: { "content-type": "application/json" },
          ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
        }),
      ),
  };
}
