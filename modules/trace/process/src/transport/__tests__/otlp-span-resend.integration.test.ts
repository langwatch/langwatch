import type { ApiKeyApi } from "@langwatch/api-key-contract";
/**
 * @vitest-environment node
 * A resent OTLP export against the COMPOSED trace app: the span claim the two
 * ingestion doors share lets the same span through once.
 */
import { canonicalErrorResponse, createRestRuntime } from "@langwatch/api/rest";
import { AuthzApi } from "@langwatch/authz-contract";
import { DataPrivacyApi } from "@langwatch/data-privacy-contract";
import { DataRetentionApi } from "@langwatch/data-retention-contract";
import { EntitlementApi } from "@langwatch/entitlement-contract";
import { ModelProviderApi } from "@langwatch/model-provider-contract";
import { LocalFeatureApis } from "@langwatch/process";
import { ProjectApi } from "@langwatch/project-contract";
import { ShareApi } from "@langwatch/share-contract";
import type { StoredObjectApi } from "@langwatch/stored-object-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { restTestAuthorization } from "@langwatch/test-harness/trpc-members";
import { TraceApi, type RecordSpanCommandData } from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";

import { TraceModule } from "../../app/trace.app.ts";
import { S3TraceLegacySpoolChannel } from "../../channels/s3/s3.trace-legacy-spool.channel.ts";
import { TraceCanonicalisationService } from "../../features/derivation/services/trace-canonicalisation.service.ts";
import { TraceBlobStoreService } from "../../features/media/services/trace-blob-store.service.ts";
import { MemoryTraceSpanDedupRepository } from "../../repositories/memory/memory.trace-span-dedup.repository.ts";
import { MemoryTraceRepositories } from "../../repositories/memory/memory.trace.repositories.ts";
import { otlpIngestDoor, otlpIngestRest } from "../otlp-ingest.rest.ts";

const PROJECT = {
  id: "project-123",
  name: "Exporting Project",
  slug: "exporting-project",
  teamId: "team-1",
  organizationId: "organization-1",
  isPersonal: false,
  ownerUserId: null,
};

/** Peers the receiver path never reaches: declared, never bound, so a call refuses by name. */
function unreachablePeers() {
  const apis = new LocalFeatureApis();
  for (const token of [
    AuthzApi,
    DataPrivacyApi,
    DataRetentionApi,
    EntitlementApi,
    ModelProviderApi,
    ProjectApi,
    ShareApi,
  ]) {
    apis.declare(token);
  }
  return {
    authz: apis.reference(AuthzApi),
    dataPrivacy: apis.reference(DataPrivacyApi),
    dataRetention: apis.reference(DataRetentionApi),
    plans: apis.reference(EntitlementApi),
    modelProviders: apis.reference(ModelProviderApi),
    projects: apis.reference(ProjectApi),
    share: apis.reference(ShareApi),
  };
}

const apiKeyDirectory: Pick<ApiKeyApi, "findResolvedToken" | "markUsed"> = {
  findResolvedToken: async () => ({
    type: "apiKey",
    apiKeyId: "api-key-1",
    userId: "user-1",
    organizationId: PROJECT.organizationId,
    ingestSourceType: null,
    ingestionTemplateId: null,
    project: PROJECT,
  }),
  markUsed: async () => undefined,
};

/** The OTLP receiver mounted as boot mounts it, over one app with the memory span claim. */
function deployment() {
  const recordedSpans: RecordSpanCommandData[] = [];
  const peers = unreachablePeers();

  const app = TraceModule.fromDependencies(
    TraceModule.composeDependencies({
      repositories: MemoryTraceRepositories.create(),
      storedObjects: createApiFixture<StoredObjectApi>(),
      canonicalisation: TraceCanonicalisationService.create(),
      blobStore: TraceBlobStoreService.create({
        legacySpool: S3TraceLegacySpoolChannel.create({
          resolveS3Client: () => Promise.reject(new Error("no object store in this test")),
        }),
      }),
      dedup: MemoryTraceSpanDedupRepository.create(),
      commands: {
        recordSpan: async (data) => {
          recordedSpans.push(data);
        },
        changeTraceName: async () => undefined,
        addAnnotation: async () => undefined,
        removeAnnotation: async () => undefined,
        assignTopic: async () => undefined,
      },
      broadcast: {
        getTenantEmitter: () => {
          throw new Error("no broadcast fabric in this test");
        },
        cleanupTenantEmitter: () => undefined,
      },
      tenantBroadcast: { publishProjectEvent: async () => {} },
      apiKeys: apiKeyDirectory,
      ingestAuthz: { hasApiKeyPermission: async () => true },
      ingestCodingAgents: { shouldFilterSpan: () => false },
      protections: {
        authz: peers.authz,
        projects: peers.projects,
        plans: peers.plans,
        dataPrivacy: peers.dataPrivacy,
        fallbackVisibilityDays: 14,
      },
      projects: peers.projects,
      modelProviders: peers.modelProviders,
      dataRetention: peers.dataRetention,
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
    doors: {
      otlp_ingest: otlpIngestDoor((input) => apis.reference(TraceApi).otlpCredential(input)),
    },
    authorization: restTestAuthorization(),
    identity: {
      authenticate: () => {
        throw new Error("the ingestion doors resolve their own credential");
      },
    },
  });
  const door = runtime.mount(otlpIngestRest.router(), {
    app: () => apis.reference(TraceApi),
    credential: "otlp_ingest",
    onError: canonicalErrorResponse,
  });

  const exportOnce = (body: unknown) =>
    door.request("/api/otel/v1/traces", {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-Auth-Token": "sk-lw-a-project-key" },
      body: JSON.stringify(body),
    });

  return { exportOnce, recordedSpans };
}

const NOW = Date.now();

/** One span, in the JSON shape an OTLP exporter posts it. */
function otlpTraceBody() {
  return {
    resourceSpans: [
      {
        resource: { attributes: [{ key: "service.name", value: { stringValue: "checkout" } }] },
        scopeSpans: [
          {
            scope: { name: "langwatch-exporter", version: "1.0.0" },
            spans: [
              {
                traceId: "b2ca0e1d9f4a4d2ab1c0d3e4f5061728",
                spanId: "a1b2c3d4e5f60710",
                name: "chat completion",
                kind: 3,
                startTimeUnixNano: `${NOW - 1000}000000`,
                endTimeUnixNano: `${NOW}000000`,
                attributes: [],
              },
            ],
          },
        ],
      },
    ],
  };
}

describe("given the trace module as a process composes it", () => {
  describe("when an exporter resends a batch it already exported", () => {
    /** @scenario "A span exported twice is recorded once" */
    it("accepts both exports and records the span once", async () => {
      const { exportOnce, recordedSpans } = deployment();

      const first = await exportOnce(otlpTraceBody());
      const second = await exportOnce(otlpTraceBody());

      expect([first.status, second.status]).toEqual([200, 200]);
      expect(recordedSpans).toHaveLength(1);
      expect(recordedSpans[0]).toMatchObject({ tenantId: PROJECT.id });
    });
  });
});
