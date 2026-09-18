import { AnnotationApi } from "@langwatch/annotation-contract";
import type { ApiKeyApi, ResolvedApiKeyCredential } from "@langwatch/api-key-contract";
/**
 * @vitest-environment node
 * `POST /api/collector` against the COMPOSITION-built app and MODULE-declared
 * transports — proves neither is stubbed. Spec: specs/traces/trace-ingestion-door.feature
 */
import { createRestRuntime, type RestErrorHandler } from "@langwatch/api/rest";
import { AuthzApi } from "@langwatch/authz-contract";
import { CodingAgentApi } from "@langwatch/coding-agent-contract";
import { DataPrivacyApi } from "@langwatch/data-privacy-contract";
import { DataRetentionApi } from "@langwatch/data-retention-contract";
import { EntitlementApi } from "@langwatch/entitlement-contract";
import { EvaluationApi } from "@langwatch/evaluation-contract";
import { HandledError } from "@langwatch/handled-error";
import { LocalFeatureApis, type FeatureTransportDescriptor } from "@langwatch/kernel";
import { LogApi } from "@langwatch/log-contract";
import { ModelProviderApi } from "@langwatch/model-provider-contract";
import { ProjectApi } from "@langwatch/project-contract";
import { ShareApi } from "@langwatch/share-contract";
import type { StoredObjectApi } from "@langwatch/stored-object-contract";
import { createApiFixture } from "@langwatch/api-fixture";
import { TopicApi } from "@langwatch/topic-contract";
import type { RecordSpanCommandData } from "@langwatch/trace-contract";
import type { ContentfulStatusCode } from "hono/utils/http-status";
import { describe, expect, it } from "vitest";

import { composeTraceAppDependencies } from "../../app/trace-read.composition.ts";
import { TraceApp } from "../../app/trace.app.ts";
import type { TraceProcessingCommands } from "../../app/trace.members.ts";
import { MemoryTraceRepositories } from "../../repositories/memory/memory.trace.repositories.ts";
import { TraceBlobStoreService } from "../../services/trace-blob-store.service.ts";
import { TraceCanonicalisationService } from "../../services/trace-canonicalisation.service.ts";
import { NullTraceSpanDedupAdapter } from "../../services/trace-span-dedup.service.ts";
import { traceServer } from "../../trace.server.ts";
import { CollectorApi, collectorRest } from "../collector.rest.ts";

const PROJECT = {
  id: "project-123",
  name: "Ingesting Project",
  slug: "ingesting-project",
  teamId: "team-1",
  organizationId: "organization-1",
  isPersonal: false,
  ownerUserId: null,
};
const TOKEN = "sk-lw-a-project-key";
const API_KEY_ID = "api-key-1";

/**
 * The peers the collector path never reaches, as real feature-API
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
type CollectorAccess = {
  /** Whether the presented token resolves at all. */
  resolves?: boolean;
  /** Whether the resolved key holds `traces:create` at its project. */
  permitted?: boolean;
  /** The credential class the token resolves to. */
  type?: ResolvedApiKeyCredential["type"];
};

/** The two API-key directory operations an ingestion door calls, and no more. */
function apiKeyDirectory(
  access: CollectorAccess,
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
 * The whole trace REST surface this module declares, mounted the way boot
 * mounts it: every declared REST transport, in declaration order, over ONE
 * application bound to its own module-API token.
 */
function deployment(access: CollectorAccess = {}) {
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
  };

  const canonicalisation = TraceCanonicalisationService.create();
  const app = TraceApp.create(
    composeTraceAppDependencies({
      repositories: MemoryTraceRepositories.create(),
      storedObjects: createApiFixture<StoredObjectApi>(),
      canonicalisation,
      blobStore: TraceBlobStoreService.create({
        resolveS3Client: () => Promise.reject(new Error("no object store in this test")),
        resolveClickHouseClient: () => Promise.reject(new Error("no ClickHouse in this test")),
      }),
      dedup: NullTraceSpanDedupAdapter.create(),
      commands,
      broadcast: {
        getTenantEmitter: () => {
          throw new Error("no broadcast fabric in this test");
        },
        cleanupTenantEmitter: () => undefined,
      },
      apiKeys: apiKeyDirectory(access, markedUsed),
      // The one question the ingest door asks, on its own narrow seam. The
      // viewer protections below stay unreachable: nothing on the ingest path
      // resolves a reader's redactions.
      ingestAuthz: { hasApiKeyPermission: async () => access.permitted !== false },
      protections: {
        authz: peers.authz,
        projects: peers.projects,
        plans: peers.plans,
        dataPrivacy: peers.dataPrivacy,
        fallbackVisibilityDays: 14,
        processName: "langwatch-api",
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
  apis.declare(CollectorApi);
  apis.bind(CollectorApi, app);
  apis.ready();

  const runtime = createRestRuntime({
    identity: {
      authenticate: () => {
        throw new Error("the ingestion doors resolve their own credential");
      },
    },
  });

  // Whether the MODULE declares the collector among its transports — the
  // point of the file: dropping it from `trace.server.ts` turns every
  // request below into the 404 a customer's SDK was getting.
  const declaredRest: readonly FeatureTransportDescriptor[] = traceServer.transports;
  const servesCollector = declaredRest.includes(collectorRest);

  const mounted = servesCollector
    ? [
        runtime.mount(collectorRest.router(), {
          app: () => apis.reference(CollectorApi),
          // The collector binds NO transport fact: it is declared public and
          // resolves the project credential inside its handler.
          credential: "public",
          onError: renderRefusal,
        }),
      ]
    : [];

  const post = async (path: string, body: unknown, headers: Record<string, string> = {}) => {
    for (const family of mounted) {
      const response = await family.request(path, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Auth-Token": TOKEN, ...headers },
        body: JSON.stringify(body),
      });
      if (response.status !== 404) return response;
    }

    return new Response(null, { status: 404 });
  };

  return { post, recordedSpans, markedUsed };
}

const NOW = Date.now();

/** One span, in the shape a released SDK posts it. */
function sdkBody(overrides: Record<string, unknown> = {}) {
  return {
    trace_id: "trace-abc",
    spans: [
      {
        type: "llm",
        span_id: "span-1",
        trace_id: "trace-abc",
        name: "chat completion",
        model: "gpt-5-mini",
        input: { type: "text", value: "hello" },
        output: { type: "text", value: "hi" },
        timestamps: { started_at: NOW - 1000, finished_at: NOW },
      },
    ],
    ...overrides,
  };
}

describe("given the trace module as a process composes it", () => {
  describe("when a released SDK posts a trace to /api/collector", () => {
    /** @scenario "The collector door accepts a trace from an SDK" */
    it("accepts the trace", async () => {
      const { post } = deployment();

      const response = await post("/api/collector", sdkBody());

      expect(response.status).toBe(200);
      expect(await response.json()).toMatchObject({ message: "Trace received successfully." });
    });

    /** @scenario "An accepted span reaches the trace pipeline" */
    it("sends the span on to the trace pipeline, against the credential's own project", async () => {
      const { post, recordedSpans } = deployment();

      await post("/api/collector", sdkBody());

      expect(recordedSpans).toHaveLength(1);
      expect(recordedSpans[0]).toMatchObject({ tenantId: PROJECT.id });
    });

    /** @scenario "An accepted trace stamps the key's last-used clock" */
    it("marks the api key used once the body has parsed", async () => {
      const { post, markedUsed } = deployment();

      await post("/api/collector", sdkBody());

      expect(markedUsed).toEqual([API_KEY_ID]);
    });
  });

  describe("when the request carries no credential at all", () => {
    /** @scenario "The collector door refuses an unauthenticated sender" */
    it("refuses with 401 and records nothing", async () => {
      const { post, recordedSpans } = deployment();

      const response = await post("/api/collector", sdkBody(), { "X-Auth-Token": "" });

      expect(response.status).toBe(401);
      expect(recordedSpans).toHaveLength(0);
    });
  });

  describe("when the token does not resolve", () => {
    it("refuses with 401 and records nothing", async () => {
      const { post, recordedSpans } = deployment({ resolves: false });

      const response = await post("/api/collector", sdkBody());

      expect(response.status).toBe(401);
      expect(recordedSpans).toHaveLength(0);
    });
  });

  describe("when the key resolves but does not hold traces:create", () => {
    /** @scenario "The collector door refuses a key without the ingest permission" */
    it("refuses the batch rather than recording it", async () => {
      const { post, recordedSpans } = deployment({ permitted: false });

      const response = await post("/api/collector", sdkBody());

      expect(response.status).toBe(403);
      expect(recordedSpans).toHaveLength(0);
    });
  });

  describe("when a legacy project key is presented", () => {
    /**
     * Project keys predate RBAC and carry full project access by design, so the
     * permission ceiling does not apply to them.
     *
     * @scenario "A legacy project key still ingests"
     */
    it("accepts the trace without asking for a permission", async () => {
      const { post, recordedSpans } = deployment({
        type: "legacyProjectKey",
        permitted: false,
      });

      const response = await post("/api/collector", sdkBody());

      expect(response.status).toBe(200);
      expect(recordedSpans).toHaveLength(1);
    });
  });
});
