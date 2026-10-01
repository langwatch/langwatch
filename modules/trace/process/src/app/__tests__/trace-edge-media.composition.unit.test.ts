/**
 * @vitest-environment node
 * Spec: specs/trace-processing/trace-media-blob-extraction.feature
 */
import type { AnnotationApi } from "@langwatch/annotation-contract";
import type { AuthzApi } from "@langwatch/authz-contract";
import type { CodingAgentApi } from "@langwatch/coding-agent-contract";
import type { DataPrivacyApi } from "@langwatch/data-privacy-contract";
import type { DataRetentionApi } from "@langwatch/data-retention-contract";
import type { EntitlementApi } from "@langwatch/entitlement-contract";
import type { EvaluationApi } from "@langwatch/evaluation-contract";
import type { FeatureFlagApi } from "@langwatch/feature-flag-contract";
import type { LogApi } from "@langwatch/log-contract";
import type { ModelProviderApi } from "@langwatch/model-provider-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import type { ShareApi } from "@langwatch/share-contract";
import type { StoredObjectApi } from "@langwatch/stored-object-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import type { TopicApi } from "@langwatch/topic-contract";
import type { RecordSpanCommandData } from "@langwatch/trace-contract";
import { describe, expect, it, vi } from "vitest";

import { S3TraceLegacySpoolChannel } from "../../channels/s3/s3.trace-legacy-spool.channel.ts";
import { MemoryTraceSpanDedupRepository } from "../../repositories/memory/memory.trace-span-dedup.repository.ts";
import { MemoryTraceRepositories } from "../../repositories/memory/memory.trace.repositories.ts";
import { TraceBlobStoreService } from "../../services/trace-blob-store.service.ts";
import { TraceCanonicalisationService } from "../../services/trace-canonicalisation.service.ts";
import { composeTraceAppDependencies } from "../trace-composition.build.ts";

const PNG_DATA_URI =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";

function compose({
  featureFlags,
  dropsContent = false,
}: {
  featureFlags?: FeatureFlagApi;
  dropsContent?: boolean;
}) {
  const refuse = () => Promise.reject(new Error("no datastore in this test"));
  const recorded: RecordSpanCommandData[] = [];
  const storeFromBytes = vi.fn(async () => ({
    reference: { id: "stored-1", mediaType: "image/png" },
    isDuplicate: false,
  }));
  const plans = createApiFixture<EntitlementApi>();
  const deps = composeTraceAppDependencies({
    repositories: MemoryTraceRepositories.create(),
    storedObjects: createApiFixture<StoredObjectApi>({ storeFromBytes } as never),
    canonicalisation: TraceCanonicalisationService.create(),
    blobStore: TraceBlobStoreService.create({
      legacySpool: S3TraceLegacySpoolChannel.create({ resolveS3Client: refuse }),
      resolveClickHouseClient: refuse,
    }),
    dedup: MemoryTraceSpanDedupRepository.create(),
    commands: {
      recordSpan: async (data) => void recorded.push(data),
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
    protections: {
      authz: createApiFixture<AuthzApi>(),
      projects: createApiFixture<ProjectApi>(),
      plans,
      dataPrivacy: createApiFixture<DataPrivacyApi>({
        dropsAnyContent: async () => dropsContent,
      }),
      fallbackVisibilityDays: 14,
      processName: "langwatch-api",
    },
    annotations: createApiFixture<AnnotationApi>(),
    codingAgents: createApiFixture<CodingAgentApi>({ shouldFilterSpan: () => false }),
    dataRetention: createApiFixture<DataRetentionApi>(),
    evaluations: createApiFixture<EvaluationApi>(),
    logs: createApiFixture<LogApi>(),
    modelProviders: createApiFixture<ModelProviderApi>(),
    projects: createApiFixture<ProjectApi>(),
    share: createApiFixture<ShareApi>(),
    topics: createApiFixture<TopicApi>(),
    requestBounds: plans,
    exportBounds: null,
    ...(featureFlags ? { featureFlags } : {}),
  });

  return { ingestion: deps.ingestion, recorded, storeFromBytes };
}

async function ingestInlineImage(composed: ReturnType<typeof compose>): Promise<string> {
  const now = String(Date.now() * 1_000_000);
  const original = JSON.stringify([
    { role: "user", content: [{ type: "image_url", image_url: { url: PNG_DATA_URI } }] },
  ]);
  await composed.ingestion?.ingestNormalizedSpan({
    tenantId: "project-1",
    span: {
      traceId: "trace-1",
      spanId: "span-1",
      parentSpanId: "",
      name: "llm",
      kind: 1,
      startTimeUnixNano: now,
      endTimeUnixNano: now,
      attributes: [{ key: "langwatch.input", value: { stringValue: original } }],
      droppedAttributesCount: 0,
      events: [],
      droppedEventsCount: 0,
      links: [],
      droppedLinksCount: 0,
      status: { code: 0, message: "" },
      traceState: "",
      flags: 0,
    },
    resource: null,
    instrumentationScope: null,
    piiRedactionLevel: "ESSENTIAL",
  });

  return original;
}

const flags = (enabled: boolean): FeatureFlagApi =>
  createApiFixture<FeatureFlagApi>({ isEnabled: async () => enabled });

const storedInput = (composed: ReturnType<typeof compose>) =>
  composed.recorded[0]?.span.attributes[0]?.value.stringValue;

describe("composeTraceAppDependencies edge media hook", () => {
  describe("given the feature flag is enabled for the project", () => {
    /** @scenario "A data-URI image inside an image_url part is externalized" */
    it("stores the bytes through Stored Object and queues a reference instead", async () => {
      const composed = compose({ featureFlags: flags(true) });

      const original = await ingestInlineImage(composed);

      expect(composed.storeFromBytes).toHaveBeenCalledOnce();
      expect(storedInput(composed)).toContain("/api/files/project-1/stored-1");
      expect(storedInput(composed)).not.toContain("base64");
      expect(storedInput(composed)).not.toBe(original);
    });
  });

  describe("given the feature flag is disabled for the project", () => {
    /** @scenario "The flag disabled keeps ingestion byte-identical to today" */
    it("queues the original inline payload and stores nothing", async () => {
      const composed = compose({ featureFlags: flags(false) });

      const original = await ingestInlineImage(composed);

      expect(composed.storeFromBytes).not.toHaveBeenCalled();
      expect(storedInput(composed)).toBe(original);
    });
  });

  describe("given the project's data-privacy policy drops span content", () => {
    /** @scenario "A project with a content-drop policy skips edge extraction" */
    it("stores no bytes at the edge and queues the span unchanged", async () => {
      const composed = compose({ featureFlags: flags(true), dropsContent: true });

      const original = await ingestInlineImage(composed);

      expect(composed.storeFromBytes).not.toHaveBeenCalled();
      expect(storedInput(composed)).toBe(original);
    });
  });
});
