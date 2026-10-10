/**
 * @vitest-environment node
 * A trace export that expands past the decompressed cap, against the COMPOSED
 * trace app and the MODULE-declared transport.
 */
import { gzipSync } from "node:zlib";

import type { ApiKeyApi } from "@langwatch/api-key-contract";
import { canonicalErrorResponse, createRestRuntime } from "@langwatch/api/rest";
import { AuthzApi } from "@langwatch/authz-contract";
import { DataPrivacyApi } from "@langwatch/data-privacy-contract";
import { DataRetentionApi } from "@langwatch/data-retention-contract";
import { EntitlementApi } from "@langwatch/entitlement-contract";
import { ModelProviderApi } from "@langwatch/model-provider-contract";
import { LocalFeatureApis, type FeatureTransportDescriptor } from "@langwatch/process";
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
import { traceProcessModule } from "../../trace.module.ts";
import { otlpIngestDoor, otlpIngestRest } from "../otlp-ingest.rest.ts";

const PROJECT = {
  id: "project-123",
  name: "Exporting Project",
  slug: "exporting-project",
  teamId: "team-1",
  organizationId: "organization-1",
  isPersonal: false,
  ownerUserId: null,
  kind: "application",
};
/** Past the shared reader's 10 MiB decompressed cap. */
const BOMB_EXPANDED_BYTES = 11 * 1024 * 1024;

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

/** The OTLP receiver mounted as boot mounts it, over one composed TraceModule. */
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

  // Mounted only if `trace.module.ts` still declares the door.
  const declaredRest: readonly FeatureTransportDescriptor[] = traceProcessModule.transports ?? [];
  const mounted = declaredRest.includes(otlpIngestRest)
    ? [
        runtime.mount(otlpIngestRest.router(), {
          app: () => apis.reference(TraceApi),
          credential: "otlp_ingest",
          onError: canonicalErrorResponse,
        }),
      ]
    : [];

  const postGzip = async (body: Uint8Array) => {
    for (const family of mounted) {
      return family.request("/api/otel/v1/traces", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-protobuf",
          "Content-Encoding": "gzip",
          "X-Auth-Token": "sk-lw-a-project-key",
        },
        body,
      });
    }
    return new Response(null, { status: 404 });
  };

  return { postGzip, recordedSpans };
}

describe("given the trace module as a process composes it", () => {
  describe("when a small gzip body expands past the decompressed cap", () => {
    /** @scenario "A trace export that decompresses past the cap is refused" */
    it("refuses it as too large and records nothing", async () => {
      const { postGzip, recordedSpans } = deployment();

      const response = await postGzip(gzipSync(Buffer.alloc(BOMB_EXPANDED_BYTES)));

      expect(response.status).toBe(413);
      expect(await response.json()).toMatchObject({ code: "ERR_PAYLOAD_TOO_LARGE" });
      expect(recordedSpans).toHaveLength(0);
    });
  });
});
