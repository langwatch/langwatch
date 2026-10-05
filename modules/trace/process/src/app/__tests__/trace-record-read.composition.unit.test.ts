/**
 * The full-record read a background settlement asks of TraceApi, as the
 * process composes it: this process's ClickHouse, the plan's visibility
 * window and the project's privacy policy.
 * @see specs/automations/worker-automation-settlement-conversion.feature
 */
import { AnnotationApi } from "@langwatch/annotation-contract";
import { AuthzApi } from "@langwatch/authz-contract";
import { CodingAgentApi } from "@langwatch/coding-agent-contract";
import {
  PLATFORM_DEFAULT_DATA_PRIVACY,
  type DataPrivacyApi,
} from "@langwatch/data-privacy-contract";
import { DataRetentionApi } from "@langwatch/data-retention-contract";
import type { EntitlementApi } from "@langwatch/entitlement-contract";
import { EvaluationApi } from "@langwatch/evaluation-contract";
import { LogApi } from "@langwatch/log-contract";
import { ModelProviderApi } from "@langwatch/model-provider-contract";
import { CLOUD_FREE_LICENSING_PLAN } from "@langwatch/plans";
import { LocalFeatureApis } from "@langwatch/process";
import type { ProjectApi, ProjectWithTeam } from "@langwatch/project-contract";
import { ShareApi } from "@langwatch/share-contract";
import type { StoredObjectApi } from "@langwatch/stored-object-contract";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { TopicApi } from "@langwatch/topic-contract";
import { describe, expect, it } from "vitest";

import { S3TraceLegacySpoolChannel } from "../../channels/s3/s3.trace-legacy-spool.channel.ts";
import { traceSummaryRow } from "../../repositories/clickhouse/__tests__/support/trace-summary-row.support.ts";
import type {
  TraceClickHouseClient,
  TraceClickHouseResolver,
} from "../../repositories/clickhouse/clickhouse.trace-member-client.repository.ts";
import { MemoryTraceSpanDedupRepository } from "../../repositories/memory/memory.trace-span-dedup.repository.ts";
import { MemoryTraceRepositories } from "../../repositories/memory/memory.trace.repositories.ts";
import { TraceBlobStoreService } from "../../services/trace-blob-store.service.ts";
import { TraceCanonicalisationService } from "../../services/trace-canonicalisation.service.ts";
import { TraceModule } from "../trace.app.ts";

const PROJECT = "project-1";
const ORGANIZATION = "organization-1";
const TRACE = "trace-1";
const DAY_MS = 24 * 60 * 60 * 1000;
const LONG_INPUT = "the settled trace's captured input, ".repeat(20);

type Query = { tenantId: string; query: string; params: Record<string, unknown> };

/** A ClickHouse that holds one trace for PROJECT, started `ageDays` ago. */
function clickHouseHolding({ ageDays, asked }: { ageDays: number; asked: Query[] }) {
  const startedAt = Date.now() - ageDays * DAY_MS;
  const resolve: TraceClickHouseResolver = async (tenantId): Promise<TraceClickHouseClient> => ({
    query: async ({ query, query_params = {} }) => {
      asked.push({ tenantId, query, params: query_params });
      const held = query_params.tenantId === PROJECT;
      if (held && query.includes("trace_summaries")) {
        return {
          json: async () => [
            traceSummaryRow({
              ts_TraceId: TRACE,
              ts_ComputedInput: JSON.stringify({ type: "text", value: LONG_INPUT }),
              ts_OccurredAt: String(startedAt),
              ts_CreatedAt: String(startedAt),
              ts_UpdatedAt: String(startedAt),
            }),
          ],
        };
      }
      return { json: async () => [] };
    },
  });
  return resolve;
}

const project = (organizationId: string): ProjectWithTeam =>
  createApiFixture<ProjectWithTeam>({
    id: PROJECT,
    team: createApiFixture<NonNullable<ProjectWithTeam["team"]>>({ organizationId }),
  });

function compose({
  resolve,
  plans,
  dataPrivacy = createApiFixture<DataPrivacyApi>({
    getResolvedForProject: async () => PLATFORM_DEFAULT_DATA_PRIVACY,
  }),
  askedOrganizations = [],
}: {
  resolve: TraceClickHouseResolver;
  plans: EntitlementApi;
  dataPrivacy?: DataPrivacyApi;
  askedOrganizations?: string[];
}) {
  const apis = new LocalFeatureApis();
  for (const token of [
    AnnotationApi,
    AuthzApi,
    CodingAgentApi,
    DataRetentionApi,
    EvaluationApi,
    LogApi,
    ModelProviderApi,
    ShareApi,
    TopicApi,
  ]) {
    apis.declare(token);
  }
  const refuse = () => Promise.reject(new Error("no datastore in this test"));
  const projects = createApiFixture<ProjectApi>({
    findWithTeam: async () => project(ORGANIZATION),
  });
  const countingPlans = createApiFixture<EntitlementApi>({
    getActivePlan: (input) => {
      askedOrganizations.push(input.organizationId);
      return plans.getActivePlan(input);
    },
  });

  const deps = TraceModule.composeDependencies({
    repositories: MemoryTraceRepositories.create(),
    resolveClickHouseClient: resolve,
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
    tenantBroadcast: { publishProjectEvent: async () => {} },
    protections: {
      authz: apis.reference(AuthzApi),
      projects,
      plans: countingPlans,
      dataPrivacy,
      fallbackVisibilityDays: 14,
    },
    annotations: apis.reference(AnnotationApi),
    codingAgents: apis.reference(CodingAgentApi),
    dataRetention: apis.reference(DataRetentionApi),
    evaluations: apis.reference(EvaluationApi),
    logs: apis.reference(LogApi),
    modelProviders: apis.reference(ModelProviderApi),
    projects,
    share: apis.reference(ShareApi),
    topics: apis.reference(TopicApi),
    requestBounds: countingPlans,
    exportBounds: null,
  });
  const tree = deps.traces.tree;
  if (!tree) throw new Error("fixture: this composition carries no tree read");
  return tree;
}

const planWithWindow = (visibilityDays: number | null) =>
  createApiFixture<EntitlementApi>({
    getActivePlan: async () => ({ ...CLOUD_FREE_LICENSING_PLAN, visibilityDays }),
  });

const inputOf = (record: { input?: { value?: unknown } | null }) => record.input?.value;

describe("given a process that composed its own ClickHouse", () => {
  /** @scenario "The worker reads a settled trace's full record for itself" */
  it("reads the record from this process's ClickHouse, scoped to the project", async () => {
    const asked: Query[] = [];
    const tree = compose({
      resolve: clickHouseHolding({ ageDays: 1, asked }),
      plans: planWithWindow(null),
    });

    const record = await tree.getById({ projectId: PROJECT, traceId: TRACE });

    expect(record.trace_id).toBe(TRACE);
    expect(inputOf(record)).toBe(LONG_INPUT);
    expect(asked.length).toBeGreaterThan(0);
    expect(asked.every((q) => q.tenantId === PROJECT && q.params.tenantId === PROJECT)).toBe(true);

    await expect(
      tree.getById({ projectId: "project-elsewhere", traceId: TRACE }),
    ).rejects.toMatchObject({ name: "TraceNotFoundError" });

    const unresolvedPolicy = compose({
      resolve: clickHouseHolding({ ageDays: 1, asked: [] }),
      plans: planWithWindow(null),
      dataPrivacy: createApiFixture<DataPrivacyApi>({
        getResolvedForProject: () => Promise.reject(new Error("policy store down")),
      }),
    });
    const hidden = await unresolvedPolicy.getById({ projectId: PROJECT, traceId: TRACE });
    expect(inputOf(hidden)).not.toBe(LONG_INPUT);
  });

  /** @scenario "Content older than the plan's window is teased in this process too" */
  it("teases content older than the plan's window and reads it whole without one", async () => {
    const askedOrganizations: string[] = [];
    const windowed = compose({
      resolve: clickHouseHolding({ ageDays: 30, asked: [] }),
      plans: planWithWindow(14),
      askedOrganizations,
    });
    const teased = await windowed.getById({ projectId: PROJECT, traceId: TRACE });
    expect(teased.redacted_by_visibility_window).toBe(true);
    expect(String(inputOf(teased)).length).toBeLessThan(LONG_INPUT.length);
    expect(askedOrganizations).toEqual([ORGANIZATION]);

    const unbounded = compose({
      resolve: clickHouseHolding({ ageDays: 30, asked: [] }),
      plans: planWithWindow(null),
    });
    const whole = await unbounded.getById({ projectId: PROJECT, traceId: TRACE });
    expect(whole.redacted_by_visibility_window).not.toBe(true);
    expect(inputOf(whole)).toBe(LONG_INPUT);

    const unresolvedPlan = compose({
      resolve: clickHouseHolding({ ageDays: 30, asked: [] }),
      plans: createApiFixture<EntitlementApi>({
        getActivePlan: () => Promise.reject(new Error("billing down")),
      }),
    });
    const fallback = await unresolvedPlan.getById({ projectId: PROJECT, traceId: TRACE });
    expect(fallback.redacted_by_visibility_window).toBe(true);
  });
});
