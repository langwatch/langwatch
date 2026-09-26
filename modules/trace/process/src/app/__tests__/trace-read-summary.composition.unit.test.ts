import { AnnotationApi } from "@langwatch/annotation-contract";
import { createApiFixture } from "@langwatch/api-fixture";
import { AuthzApi } from "@langwatch/authz-contract";
import { CodingAgentApi } from "@langwatch/coding-agent-contract";
import { DataPrivacyApi } from "@langwatch/data-privacy-contract";
import { DataRetentionApi } from "@langwatch/data-retention-contract";
import { EntitlementApi } from "@langwatch/entitlement-contract";
import { EvaluationApi } from "@langwatch/evaluation-contract";
import type { FoldProjectionStore, FoldStateRead } from "@langwatch/eventing";
import { LocalFeatureApis } from "@langwatch/kernel";
import { LogApi } from "@langwatch/log-contract";
import { ModelProviderApi } from "@langwatch/model-provider-contract";
import { ProjectApi } from "@langwatch/project-contract";
import { ShareApi } from "@langwatch/share-contract";
import type { StoredObjectApi } from "@langwatch/stored-object-contract";
import { TopicApi } from "@langwatch/topic-contract";
import { traceSummaryDataSchema, type TraceSummaryData } from "@langwatch/trace-contract";
import { describe, expect, it } from "vitest";

import { S3TraceLegacySpoolChannel } from "../../channels/s3/s3.trace-legacy-spool.channel.ts";
import { MemoryTraceSpanDedupRepository } from "../../repositories/memory/memory.trace-span-dedup.repository.ts";
import { MemoryTraceRepositories } from "../../repositories/memory/memory.trace.repositories.ts";
import { TraceBlobStoreService } from "../../services/trace-blob-store.service.ts";
import { TraceCanonicalisationService } from "../../services/trace-canonicalisation.service.ts";
import { composeTraceAppDependencies } from "../trace-read.composition.ts";

const FOLDED: TraceSummaryData = traceSummaryDataSchema.parse({
  traceId: "trace-1",
  spanCount: 2,
  totalDurationMs: 40,
  computedIOSchemaVersion: "v1",
  computedInput: "hello",
  computedOutput: "world",
  timeToFirstTokenMs: null,
  timeToLastTokenMs: null,
  tokensPerSecond: null,
  containsErrorStatus: false,
  containsOKStatus: true,
  errorMessage: null,
  models: ["gpt-5"],
  totalCost: null,
  nonBilledCost: null,
  tokensEstimated: false,
  totalPromptTokenCount: null,
  totalCompletionTokenCount: null,
  outputFromRootSpan: true,
  outputSpanEndTimeMs: 1040,
  blockedByGuardrail: false,
  rootSpanType: "llm",
  containsAi: true,
  containsPrompt: false,
  selectedPromptId: null,
  selectedPromptSpanId: null,
  selectedPromptStartTimeMs: null,
  lastUsedPromptId: null,
  lastUsedPromptVersionNumber: null,
  lastUsedPromptVersionId: null,
  lastUsedPromptSpanId: null,
  lastUsedPromptStartTimeMs: null,
  topicId: null,
  subTopicId: null,
  annotationIds: [],
  attributes: {},
  traceName: "assistant",
  occurredAt: 1000,
  createdAt: 1000,
  updatedAt: 1040,
  LastEventOccurredAt: 1040,
});

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

type Composed = {
  withClickHouse?: boolean;
  summaryStore?: FoldProjectionStore<TraceSummaryData>;
};

function compose({ withClickHouse = true, summaryStore }: Composed) {
  const peers = unreachablePeers();
  const refuse = () => Promise.reject(new Error("no datastore in this test"));

  return composeTraceAppDependencies({
    repositories: MemoryTraceRepositories.create(),
    ...(withClickHouse ? { resolveClickHouseClient: refuse } : {}),
    ...(summaryStore ? { summaryStore } : {}),
    storedObjects: createApiFixture<StoredObjectApi>(),
    canonicalisation: TraceCanonicalisationService.create(),
    blobStore: TraceBlobStoreService.create({
      legacySpool: S3TraceLegacySpoolChannel.create({ resolveS3Client: refuse }),
      resolveClickHouseClient: refuse,
    }),
    dedup: MemoryTraceSpanDedupRepository.create(),
    commands: {
      recordSpan: async () => undefined,
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
    protections: {
      authz: peers.authz,
      projects: peers.projects,
      plans: peers.plans,
      dataPrivacy: peers.dataPrivacy,
      fallbackVisibilityDays: 14,
      processName: "langwatch-api",
    },
    ...peers,
    requestBounds: peers.plans,
    exportBounds: null,
  });
}

function summaryStoreReading(read: FoldStateRead<TraceSummaryData>) {
  const asked: { aggregateId: string; tenantId: string }[] = [];
  const store = createApiFixture<FoldProjectionStore<TraceSummaryData>>({
    get: async (aggregateId, context) => {
      asked.push({ aggregateId, tenantId: context.tenantId });
      return read;
    },
  });

  return { store, asked };
}

const LOOKUP = { projectId: "project-1", traceId: "trace-1" };

describe("composeTraceAppDependencies summary reader", () => {
  it("answers the folded summary, asking the fold for the trace under its tenant", async () => {
    const { store, asked } = summaryStoreReading({ kind: "folded", state: FOLDED });

    await expect(compose({ summaryStore: store }).traces.tree.findSummary(LOOKUP)).resolves.toEqual(
      FOLDED,
    );
    expect(asked).toEqual([{ aggregateId: "trace-1", tenantId: "project-1" }]);
  });

  it("answers null while nothing has been folded for the trace", async () => {
    const { store } = summaryStoreReading({ kind: "empty" });

    await expect(
      compose({ summaryStore: store }).traces.tree.findSummary(LOOKUP),
    ).resolves.toBeNull();
  });

  it("answers null on a process that folds no trace projections", async () => {
    await expect(compose({}).traces.tree.findSummary(LOOKUP)).resolves.toBeNull();
  });

  it("refuses the tree read by name on a process that composed no ClickHouse", () => {
    const { store } = summaryStoreReading({ kind: "folded", state: FOLDED });
    const deps = compose({ withClickHouse: false, summaryStore: store });

    expect(() => deps.traces.tree.findSummary(LOOKUP)).toThrow(
      expect.objectContaining({ code: "service_unavailable" }),
    );
  });
});
