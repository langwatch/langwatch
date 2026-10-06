import { AnnotationApi } from "@langwatch/annotation-contract";
import type { ApiKeyApi, ResolvedApiKeyCredential } from "@langwatch/api-key-contract";
/**
 * @vitest-environment node
 * `POST /api/otel/v1/{...}` against the COMPOSITION-built app and
 * MODULE-declared transports — sibling of the collector composition test.
 */
import { createRestRuntime, type RestErrorHandler } from "@langwatch/api/rest";
import { AuthzApi } from "@langwatch/authz-contract";
import { CodingAgentApi } from "@langwatch/coding-agent-contract";
import { DataPrivacyApi } from "@langwatch/data-privacy-contract";
import { DataRetentionApi } from "@langwatch/data-retention-contract";
import { EntitlementApi } from "@langwatch/entitlement-contract";
import { EvaluationApi } from "@langwatch/evaluation-contract";
import { HandledError } from "@langwatch/handled-error";
import { LogApi } from "@langwatch/log-contract";
import { ModelProviderApi } from "@langwatch/model-provider-contract";
import type * as Observability from "@langwatch/observability";
import { LocalFeatureApis, type FeatureTransportDescriptor } from "@langwatch/process";
import { ProjectApi } from "@langwatch/project-contract";
import { ShareApi } from "@langwatch/share-contract";
import type { StoredObjectApi } from "@langwatch/stored-object-contract";
import type * as TestHarness from "@langwatch/test-harness";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { TopicApi } from "@langwatch/topic-contract";
import { TraceApi, type RecordSpanCommandData } from "@langwatch/trace-contract";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { describe, expect, it, vi } from "vitest";

import { TraceModule } from "../../app/trace.app.ts";
import { S3TraceLegacySpoolChannel } from "../../channels/s3/s3.trace-legacy-spool.channel.ts";
import { MemoryTraceSpanDedupRepository } from "../../repositories/memory/memory.trace-span-dedup.repository.ts";
import { MemoryTraceRepositories } from "../../repositories/memory/memory.trace.repositories.ts";
import { TraceBlobStoreService } from "../../services/trace-blob-store.service.ts";
import { TraceCanonicalisationService } from "../../services/trace-canonicalisation.service.ts";
import type { TraceProcessingCommands } from "../../services/trace-processing-commands.service.ts";
import { traceProcessModule } from "../../trace.module.ts";
import { otlpIngestRest } from "../otlp-ingest.rest.ts";

const doorLog = vi.hoisted(() => ({
  loggerName: "langwatch:otel:v1:traces",
  lines: [] as { msg?: string; [field: string]: unknown }[],
}));

// The receiver's logger is built at import; this hands it a capturing one.
vi.mock("@langwatch/observability", async (importOriginal) => {
  const original = await importOriginal<typeof Observability>();
  const harness = await vi.importActual<typeof TestHarness>("@langwatch/test-harness");
  const door = harness.createTestLogger();
  doorLog.lines = door.lines;

  return {
    ...original,
    createLogger: (name: string, options?: Parameters<typeof original.createLogger>[1]) =>
      name === doorLog.loggerName ? door.logger : original.createLogger(name, options),
  };
});

const PROJECT = {
  id: "project-123",
  name: "Exporting Project",
  slug: "exporting-project",
  teamId: "team-1",
  organizationId: "organization-1",
  isPersonal: false,
  ownerUserId: null,
};
const TOKEN = "sk-lw-a-project-key";
const API_KEY_ID = "api-key-1";

/**
 * The peers the receiver path never reaches, as real feature-API
 * references: declared but deliberately never bound, so a call refuses by
 * name instead of quietly answering. No cast, no hand-written twin.
 */
function unreachablePeers() {
  const apis = new LocalFeatureApis();
  for (const token of [
    AnnotationApi,
    AuthzApi,
    CodingAgentApi,
    DataPrivacyApi,
    DataRetentionApi,
    EntitlementApi,
    EvaluationApi,
    LogApi,
    ModelProviderApi,
    ProjectApi,
    ShareApi,
    TopicApi,
  ]) {
    apis.declare(token);
  }

  return {
    annotations: apis.reference(AnnotationApi),
    authz: apis.reference(AuthzApi),
    codingAgents: apis.reference(CodingAgentApi),
    dataPrivacy: apis.reference(DataPrivacyApi),
    dataRetention: apis.reference(DataRetentionApi),
    plans: apis.reference(EntitlementApi),
    evaluations: apis.reference(EvaluationApi),
    logs: apis.reference(LogApi),
    modelProviders: apis.reference(ModelProviderApi),
    projects: apis.reference(ProjectApi),
    share: apis.reference(ShareApi),
    topics: apis.reference(TopicApi),
  };
}

/** What a test may narrow about the credential the door is reached with. */
type OtlpAccess = {
  /** Whether the presented token resolves at all. */
  resolves?: boolean;
  /** Whether the resolved key holds `traces:create` at its project. */
  permitted?: boolean;
  /** The credential class the token resolves to. */
  type?: ResolvedApiKeyCredential["type"];
};

/** The two API-key directory operations an ingestion door calls, and no more. */
function apiKeyDirectory(
  access: OtlpAccess,
  markedUsed: string[],
): Pick<ApiKeyApi, "findResolvedToken" | "markUsed"> {
  return {
    findResolvedToken: async () => {
      if (access.resolves === false) return null;
      if (access.type === "legacyProjectKey") {
        return { type: "legacyProjectKey", project: PROJECT };
      }

      return {
        type: "apiKey",
        apiKeyId: API_KEY_ID,
        userId: "user-1",
        organizationId: PROJECT.organizationId,
        ingestSourceType: null,
        ingestionTemplateId: null,
        project: PROJECT,
      };
    },
    markUsed: async ({ id }: { id: string }) => {
      markedUsed.push(id);
    },
  };
}

/** The flat body this deployment's boundary publishes for a handled refusal. */
const renderRefusal: RestErrorHandler = (error, c) => {
  if (HandledError.isHandled(error)) {
    const serialized = error.serialize();

    return c.json(
      { error: serialized.code, message: error.message },
      serialized.httpStatus as ContentfulStatusCode,
    );
  }

  return c.json({ error: "Internal server error" }, 500);
};

/**
 * The trace REST surface this module declares, mounted the way boot mounts it:
 * the declared transport, over ONE application bound to its own module-API
 * token.
 */
function deployment(access: OtlpAccess = {}) {
  const recordedSpans: RecordSpanCommandData[] = [];
  const markedUsed: string[] = [];
  const peers = unreachablePeers();

  const commands: TraceProcessingCommands = {
    recordSpan: async (data) => {
      recordedSpans.push(data);
    },
    changeTraceName: async () => undefined,
    addAnnotation: async () => undefined,
    removeAnnotation: async () => undefined,
    assignTopic: async () => undefined,
  };

  const canonicalisation = TraceCanonicalisationService.create();
  const app = TraceModule.fromDependencies(
    TraceModule.composeDependencies({
      repositories: MemoryTraceRepositories.create(),
      storedObjects: createApiFixture<StoredObjectApi>(),
      canonicalisation,
      blobStore: TraceBlobStoreService.create({
        legacySpool: S3TraceLegacySpoolChannel.create({
          resolveS3Client: () => Promise.reject(new Error("no object store in this test")),
        }),
        resolveClickHouseClient: () => Promise.reject(new Error("no ClickHouse in this test")),
      }),
      dedup: MemoryTraceSpanDedupRepository.create(),
      commands,
      broadcast: {
        getTenantEmitter: () => {
          throw new Error("no broadcast fabric in this test");
        },
        cleanupTenantEmitter: () => undefined,
      },
      tenantBroadcast: { publishProjectEvent: async () => {} },
      apiKeys: apiKeyDirectory(access, markedUsed),
      // The two questions the ingest path asks, each on its own narrow seam:
      // may this key create traces, and is this span one a coding agent emits
      // about itself. The viewer protections below stay unreachable - nothing
      // on the ingest path resolves a reader's redactions.
      ingestAuthz: { hasApiKeyPermission: async () => access.permitted !== false },
      ingestCodingAgents: { shouldFilterSpan: () => false },
      protections: {
        authz: peers.authz,
        projects: peers.projects,
        plans: peers.plans,
        dataPrivacy: peers.dataPrivacy,
        fallbackVisibilityDays: 14,
      },
      projects: peers.projects,
      topics: peers.topics,
      modelProviders: peers.modelProviders,
      logs: peers.logs,
      annotations: peers.annotations,
      dataRetention: peers.dataRetention,
      evaluations: peers.evaluations,
      codingAgents: peers.codingAgents,
      share: peers.share,
      requestBounds: peers.plans,
      exportBounds: null,
    }),
  );

  const apis = new LocalFeatureApis();
  apis.declare(TraceApi);
  apis.bind(TraceApi, app);
  apis.ready();

  const runtime = createRestRuntime({
    identity: {
      authenticate: () => {
        throw new Error("the ingestion doors resolve their own credential");
      },
    },
  });

  // Whether the MODULE declares the receiver among its transports. This is the
  // point of the file: the door is mounted here only if `trace.module.ts` still
  // mounts it, so dropping it there turns every request below into the 404 an
  // OTLP exporter was getting.
  const declaredRest: readonly FeatureTransportDescriptor[] = traceProcessModule.transports;
  const servesOtlp = declaredRest.includes(otlpIngestRest);

  const mounted = servesOtlp
    ? [
        runtime.mount(otlpIngestRest.router(), {
          app: () => apis.reference(TraceApi),
          // The receiver binds NO transport fact: it is declared public and
          // resolves the project credential inside its handler.
          credential: "public",
          onError: renderRefusal,
        }),
      ]
    : [];

  const post = async (path: string, body: unknown, headers: Record<string, string> = {}) => {
    for (const family of mounted) {
      return family.request(path, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Auth-Token": TOKEN, ...headers },
        body: JSON.stringify(body),
      });
    }

    // Nothing mounted: the same 404 an exporter met while this family was
    // declared and served by nobody.
    return new Response(null, { status: 404 });
  };

  const postStream = async (path: string, chunks: readonly Uint8Array[]) => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const chunk of chunks) controller.enqueue(chunk);
        controller.close();
      },
    });
    for (const family of mounted) {
      return family.request(path, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Auth-Token": TOKEN },
        body: stream,
        duplex: "half",
      } as RequestInit);
    }

    return new Response(null, { status: 404 });
  };

  return { post, postStream, recordedSpans, markedUsed };
}

const NOW = Date.now();
const NANOS = "000000";

/** `count` spans, in the JSON shape an OTLP exporter posts them. */
function otlpTraceBody(count = 1) {
  return {
    resourceSpans: [
      {
        resource: {
          attributes: [{ key: "service.name", value: { stringValue: "checkout" } }],
        },
        scopeSpans: [
          {
            scope: { name: "langwatch-exporter", version: "1.0.0" },
            spans: Array.from({ length: count }, (_, index) => ({
              traceId: "b2ca0e1d9f4a4d2ab1c0d3e4f5061728",
              spanId: `a1b2c3d4e5f6071${index}`,
              name: "chat completion",
              kind: 3,
              startTimeUnixNano: `${NOW - 1000}${NANOS}`,
              endTimeUnixNano: `${NOW}${NANOS}`,
              attributes: [],
            })),
          },
        ],
      },
    ],
  };
}

describe("given the trace module as a process composes it", () => {
  describe("when an OTLP exporter posts a trace batch to /api/otel/v1/traces", () => {
    /** @scenario "The OTLP receiver accepts an exported trace batch" */
    it("accepts the batch", async () => {
      const { post } = deployment();

      const response = await post("/api/otel/v1/traces", otlpTraceBody());

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ message: "Trace received successfully." });
    });

    /** @scenario "An exported span reaches the trace pipeline" */
    it("sends the span on to the trace pipeline, against the credential's own project", async () => {
      const { post, recordedSpans } = deployment();

      await post("/api/otel/v1/traces", otlpTraceBody());

      expect(recordedSpans).toHaveLength(1);
      expect(recordedSpans[0]).toMatchObject({ tenantId: PROJECT.id });
    });

    /** @scenario "An accepted export stamps the key's last-used clock" */
    it("marks the api key used once the body has parsed", async () => {
      const { post, markedUsed } = deployment();

      await post("/api/otel/v1/traces", otlpTraceBody());

      expect(markedUsed).toEqual([API_KEY_ID]);
    });
  });

  describe("when the export carries no credential at all", () => {
    /** @scenario "The OTLP receiver refuses an unauthenticated exporter" */
    it("refuses with 401 and records nothing", async () => {
      const { post, recordedSpans } = deployment();

      const response = await post("/api/otel/v1/traces", otlpTraceBody(), { "X-Auth-Token": "" });

      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({
        message:
          "Authentication token is required. Use X-Auth-Token header, Authorization: Bearer token, or Authorization: Basic base64(projectId:token).",
      });
      expect(recordedSpans).toHaveLength(0);
    });
  });

  describe("when an exporter appends the signal to a root-level base", () => {
    /** @scenario "A corrected path answers like the canonical one" */
    it("accepts the same bytes and returns the canonical trace status", async () => {
      const { post, recordedSpans } = deployment();

      const response = await post("/v1/traces", otlpTraceBody());

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ message: "Trace received successfully." });
      expect(recordedSpans).toHaveLength(1);
    });

    /** @scenario "A corrected path still needs a valid key" */
    it("applies the canonical credential refusal before parsing the alias body", async () => {
      const { post, recordedSpans } = deployment();

      const response = await post("/v1/traces", otlpTraceBody(), { "X-Auth-Token": "" });

      expect(response.status).toBe(401);
      expect(recordedSpans).toHaveLength(0);
    });
  });

  describe("when an exporter named the collector as its base endpoint", () => {
    /** @scenario "An endpoint that named the collector" */
    it.each(["/api/collector/api/otel/v1/traces", "/api/collector/v1/traces"])(
      "serves spans posted to %s as trace ingestion",
      async (path) => {
        const { post, recordedSpans } = deployment();

        const response = await post(path, otlpTraceBody());

        expect(response.status).toBe(200);
        expect(await response.json()).toMatchObject({ message: "Trace received successfully." });
        expect(recordedSpans).toHaveLength(1);
        expect(recordedSpans[0]).toMatchObject({ tenantId: PROJECT.id });
      },
    );
  });

  describe("when an exporter posts spans to the canonical path with a trailing slash", () => {
    /** @scenario "An endpoint with a stray trailing slash" */
    it("serves them as trace ingestion", async () => {
      const { post, recordedSpans } = deployment();

      const response = await post("/api/otel/v1/traces/", otlpTraceBody());

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ message: "Trace received successfully." });
      expect(recordedSpans).toHaveLength(1);
    });
  });

  describe("when an exporter streams spans to a misconfigured path", () => {
    /** @scenario "A streamed payload survives the correction" */
    it("hands every span of the streamed body to ingestion", async () => {
      const { postStream, recordedSpans } = deployment();
      const bytes = new TextEncoder().encode(JSON.stringify(otlpTraceBody(3)));
      const third = Math.ceil(bytes.byteLength / 3);
      const chunks = [bytes.slice(0, third), bytes.slice(third, third * 2), bytes.slice(third * 2)];

      const response = await postStream("/v1/traces", chunks);

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ message: "Trace received successfully." });
      expect(recordedSpans).toHaveLength(3);
    });
  });

  describe("when a request arrives on a path that no known misconfiguration produces", () => {
    /** @scenario "An unrelated path that happens to end in a signal name" */
    it.each(["/api/gateway/v1/traces", "/api/rum/v1/traces", "/api/ingest/otel/src_123/v1/traces"])(
      "does not treat %s as ingestion",
      async (path) => {
        const { post, recordedSpans, markedUsed } = deployment();

        const response = await post(path, otlpTraceBody());

        expect(response.status).toBe(404);
        expect(recordedSpans).toHaveLength(0);
        expect(markedUsed).toHaveLength(0);
      },
    );

    /** @scenario "A path naming something other than a signal" */
    it.each(["/api/otel/v1/traces/v1/profiles", "/api/otel/v1/traces/v2/traces", "/api/collector"])(
      "does not treat the unknown suffix of %s as ingestion",
      async (path) => {
        const { post, recordedSpans, markedUsed } = deployment();

        const response = await post(path, otlpTraceBody());

        expect(response.status).toBe(404);
        expect(recordedSpans).toHaveLength(0);
        expect(markedUsed).toHaveLength(0);
      },
    );
  });

  describe("when an exporter posts repeatedly to the same misconfigured path", () => {
    /** @scenario "A repeated misconfiguration is reported once a window" */
    it("reports the correction once rather than once per batch", async () => {
      const { post } = deployment();
      const misconfiguredPath = "/api/v1/traces";

      for (let batch = 0; batch < 3; batch += 1) {
        const response = await post(misconfiguredPath, otlpTraceBody());
        expect(response.status).toBe(200);
      }

      const reports = doorLog.lines.filter(
        (line) =>
          line.msg?.includes("non-canonical path") && line.originalPath === misconfiguredPath,
      );
      expect(reports).toHaveLength(1);
      expect(reports[0]).toMatchObject({
        projectId: PROJECT.id,
        canonicalPath: "/api/otel/v1/traces",
      });
    });
  });

  describe("when the token does not resolve", () => {
    it("refuses with 401 and records nothing", async () => {
      const { post, recordedSpans } = deployment({ resolves: false });

      const response = await post("/api/otel/v1/traces", otlpTraceBody());

      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ message: "Invalid auth token." });
      expect(recordedSpans).toHaveLength(0);
    });
  });

  describe("when the key resolves but does not hold traces:create", () => {
    /** @scenario "The OTLP receiver refuses a key without the ingest permission" */
    it("refuses the batch rather than recording it", async () => {
      const { post, recordedSpans } = deployment({ permitted: false });

      const response = await post("/api/otel/v1/traces", otlpTraceBody());

      expect(response.status).toBe(403);
      const body = await response.json();
      expect(body).toMatchObject({
        error: "api_key_permission_denied",
        permission: "traces:create",
        retryable: false,
      });
      expect(body).not.toHaveProperty("code");
      expect(recordedSpans).toHaveLength(0);
    });
  });

  describe("when a legacy project key is presented", () => {
    /**
     * Project keys predate RBAC and carry full project access by design, so the
     * permission ceiling does not apply to them.
     *
     * @scenario "A legacy project key still exports"
     */
    it("accepts the batch without asking for a permission", async () => {
      const { post, recordedSpans } = deployment({
        type: "legacyProjectKey",
        permitted: false,
      });

      const response = await post("/api/otel/v1/traces", otlpTraceBody());

      expect(response.status).toBe(200);
      expect(recordedSpans).toHaveLength(1);
    });
  });
});
