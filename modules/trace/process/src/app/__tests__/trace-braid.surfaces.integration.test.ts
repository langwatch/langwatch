/**
 * Outside the trace view a project shows only its own spans (ADR-183 §5), against production
 * schema: every surface below reads an orchestrator trace holding a braided span while each proof
 * it is handed carries the braid, and none returns the owner's span. Analytics: modules/analytics.
 */
import type { ClickHouseClient } from "@clickhouse/client";
import {
  bindMiddlewareContext,
  canonicalErrorResponse,
  createRestRuntime,
  projectRequestContext,
} from "@langwatch/api/rest";
import type { CompiledWhere } from "@langwatch/authorization";
import type { AuthzApi } from "@langwatch/authz-contract";
import {
  type DataPrivacyApi,
  PLATFORM_DEFAULT_DATA_PRIVACY,
} from "@langwatch/data-privacy-contract";
import type { EntitlementApi, PlanProvider } from "@langwatch/entitlement-contract";
import type { PresenceApi } from "@langwatch/presence-contract";
import type { ProjectApi } from "@langwatch/project-contract";
import { createTestLogger } from "@langwatch/test-harness";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { testAuthorizeDefaults } from "@langwatch/test-harness/trpc-members";
import { nanoid } from "nanoid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { TraceCanonicalisationService } from "#features/derivation/services/trace-canonicalisation.service";

import { braidedProof } from "../../__tests__/support/authorization-proofs.fixture.ts";
import { TraceEditOverlayService } from "../../features/edit-overlay/services/trace-edit-overlay.service.ts";
import { CLICKHOUSE_FACET_CATALOG } from "../../features/facet/repositories/clickhouse/clickhouse.trace-facet-registry.mapper.ts";
import { TraceLegacyReadClickHouseRepository } from "../../features/legacy/repositories/clickhouse/trace-legacy-read.repository.ts";
import { TraceLegacyReadService } from "../../features/legacy/services/trace-legacy-read.service.ts";
import { TraceListService } from "../../features/read/services/trace-list-read.service.ts";
import { authorizedClickHouseFor } from "../../repositories/clickhouse/__tests__/support/authorized-clickhouse.support.ts";
import {
  startMigratedTraceClickHouse,
  testClickHouseConfigured,
} from "../../repositories/clickhouse/__tests__/support/clickhouse-endpoint.support.ts";
import { TraceListClickHouseRepository } from "../../repositories/clickhouse/trace-list.repository.ts";
import { MemoryTraceEditOverlayRepository } from "../../repositories/memory/memory.trace-edit-overlay.repository.ts";
import { MemoryTraceEvaluationRunsRepository } from "../../repositories/memory/memory.trace-evaluation-runs.repository.ts";
import { MemoryTraceTopicNamesRepository } from "../../repositories/memory/memory.trace-topic-names.repository.ts";
import { TraceViewerProtectionService } from "../../services/trace-viewer-protection.service.ts";
import { tracesRest, tracesRestCredential } from "../../transport/traces.rest.ts";
import { TraceModule } from "../trace.app.ts";
import { createTraceAppHarness } from "./support/trace-app.harness.ts";

const clickHouseConfigured = testClickHouseConfigured();

const run = nanoid();
const reader = `test-surfaces-reader-${run}`;
const owner = `test-surfaces-owner-${run}`;
const traceId = `trace-surfaces-${run}`;
const base = Date.now() - 60 * 60 * 1000;
const WINDOW = { from: base - 24 * 60 * 60 * 1000, to: Date.now() + 60 * 60 * 1000 };
const WEB: CompiledWhere = {
  version: 1,
  tree: { kind: "attributeEquals", on: "span", key: "orchestrator", value: "web" },
};
/** What only the owner's braided span carries: its id, name, service and attribute. */
const OWNER_MARKS = [
  "owner-web",
  "specialist_secret_agent",
  "specialist-service",
  "specialist",
  `"totalCost":99`,
  `"total_cost":99`,
];

const proof = () => braidedProof({ projectId: reader, braids: [{ owner, compiledWhere: WEB }] });

let ch: ClickHouseClient;
let app: TraceModule;

function summaryRow({
  tenantId,
  cost,
  tokens,
}: {
  tenantId: string;
  cost: number;
  tokens: number;
}) {
  return {
    ProjectionId: `proj-${nanoid()}`,
    TenantId: tenantId,
    TraceId: traceId,
    Version: "v1",
    Attributes: {},
    OccurredAt: new Date(base),
    CreatedAt: new Date(base),
    UpdatedAt: new Date(base),
    ComputedIOSchemaVersion: "v1",
    ComputedInput: `input of ${tenantId}`,
    ComputedOutput: `output of ${tenantId}`,
    TotalDurationMs: 100,
    SpanCount: 1,
    TotalCost: cost,
    TotalPromptTokenCount: tokens,
    TotalCompletionTokenCount: tokens,
    ContainsErrorStatus: false,
    ContainsOKStatus: true,
    Models: [],
    TokensEstimated: false,
    OutputFromRootSpan: false,
    OutputSpanEndTimeMs: 0,
    BlockedByGuardrail: false,
    TraceName: `name-of-${tenantId}`,
    RootSpanType: "",
    ContainsAi: false,
    ContainsPrompt: false,
    AnnotationIds: [],
    LastEventOccurredAt: new Date(base),
  };
}

function spanRow(input: {
  tenantId: string;
  spanId: string;
  name: string;
  service: string;
  attributes: Record<string, string>;
}) {
  return {
    ProjectionId: `proj-${nanoid()}`,
    TenantId: input.tenantId,
    TraceId: traceId,
    SpanId: input.spanId,
    ParentSpanId: null,
    ParentTraceId: null,
    ParentIsRemote: null,
    Sampled: 1,
    StartTime: new Date(base + 10),
    EndTime: new Date(base + 60),
    DurationMs: 50,
    SpanName: input.name,
    SpanKind: 1,
    ServiceName: input.service,
    ResourceAttributes: { "service.name": input.service },
    SpanAttributes: input.attributes,
    StatusCode: 1,
    StatusMessage: null,
    ScopeName: "test",
    ScopeVersion: null,
    CreatedAt: new Date(base),
    UpdatedAt: new Date(base),
  };
}

const settings = { async_insert: 0, wait_for_async_insert: 0 } as const;

function composeApp(): TraceModule {
  const clickhouse = authorizedClickHouseFor(ch);
  const evaluationRuns = MemoryTraceEvaluationRunsRepository.create();
  const canonicalisation = TraceCanonicalisationService.create();
  const legacy = TraceLegacyReadClickHouseRepository.create({
    clickhouse,
    resolveClickHouseClient: async () => ch,
  });
  const allowed = async () => true;
  return createTraceAppHarness({
    traces: {
      read: TraceLegacyReadService.create({
        traceCanonicalisation: canonicalisation,
        traceRead: legacy,
        mapping: TraceModule.composeLegacyRead({
          repository: legacy,
          traceCanonicalisation: canonicalisation,
        }),
        editOverlay: TraceEditOverlayService.create(MemoryTraceEditOverlayRepository.create()),
        evaluationRuns,
      }),
      list: TraceListService.create({
        repository: TraceListClickHouseRepository.create({ clickhouse }),
        evaluationRuns,
        topicNames: MemoryTraceTopicNamesRepository.create(),
        facets: CLICKHOUSE_FACET_CATALOG,
        discoverUpdates: createApiFixture<PresenceApi>({ publishProjectEvent: async () => {} }),
      }),
    },
    evaluationRuns,
    projects: createApiFixture<ProjectApi>(
      {
        findById: async () => null,
        getOrganizationId: async () => "test-organization",
      },
      "projects",
    ),
    protections: TraceViewerProtectionService.create({
      authz: createApiFixture<AuthzApi>({ hasPermission: allowed }, "authz"),
      projects: createApiFixture<ProjectApi>({ findWithTeam: async () => null }, "projects"),
      plans: createApiFixture<PlanProvider>({}, "plans"),
      dataPrivacy: createApiFixture<DataPrivacyApi>(
        { getResolvedForProjects: async () => PLATFORM_DEFAULT_DATA_PRIVACY },
        "dataPrivacy",
      ),
      fallbackVisibilityDays: 30,
      logger: createTestLogger().logger,
    }),
    // The worst case: even the proof the app mints for itself carries the reader's braid.
    authorizeRead: async () => proof(),
    requestBounds: createApiFixture<Pick<EntitlementApi, "requestBound">>({
      requestBound: async () => 1_000,
    }),
    exportBounds: {
      assertExportWithinRate: async () => {},
      acquireExportSlot: async () => ({ release: async () => {} }),
    },
    presence: createApiFixture<PresenceApi>({ publishProjectEvent: async () => {} }),
    publicBaseUrl: "https://app.langwatch.test",
  });
}

/** The REST door as an API key reaches it, minting a proof that carries the reader's braid. */
function restDoor() {
  const permitted = { permitted: true, organizationRole: null } as const;
  const runtime = createRestRuntime({
    audit: { record: () => {} },
    authorization: {
      forRequest: () => ({
        ...testAuthorizeDefaults,
        authorization: async () => proof(),
        getDecision: async () => permitted,
        getProjectAnyDecision: async () => permitted,
        checkScopeLineage: async () => ({ kind: "consistent" as const }),
      }),
    },
    identity: {
      authenticate: () => ({
        actor: { type: "user" as const, id: "sam" },
        scope: { tier: "project" as const, id: reader },
      }),
    },
  });
  const hono = runtime.mount(tracesRest.router(), {
    app: () => app,
    credential: "project",
    onError: canonicalErrorResponse,
    middlewareContext: [
      bindMiddlewareContext(projectRequestContext, () => ({
        projectSlug: "orchestrator",
        viewerUserId: null,
        actorId: "sam",
      })),
      bindMiddlewareContext(tracesRestCredential, () => ({ principal: null })),
    ],
  });
  return {
    search: async (body: Record<string, unknown>) =>
      answered(
        await hono.request("http://api.test/api/v1/traces/search", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ startDate: WINDOW.from, endDate: WINDOW.to, ...body }),
        }),
      ),
    get: async (format: "json" | "digest") =>
      answered(await hono.request(`http://api.test/api/v1/traces/${traceId}?format=${format}`)),
  };
}

async function answered(response: Response): Promise<string> {
  const body = await response.text();
  if (response.status !== 200) throw new Error(`answered ${response.status}: ${body}`);
  return body;
}

/** The explorer's list route: protections, the compiled query, then the list read. */
async function explorerList(query: string) {
  const authorization = proof();
  const protections = await app.resolveViewerProtections({
    projectId: reader,
    userId: "sam",
    authorization,
  });
  const filterWhere = await app.compileExplorerTraceFilter({
    query,
    tenantId: reader,
    timeRange: WINDOW,
    protections,
  });
  return app.readTraceList({
    authorization,
    timeRange: WINDOW,
    sort: { columnId: "timestamp", direction: "desc" },
    pageSize: 50,
    filterWhere,
    visibilityCutoffMs: protections.visibilityCutoffMs,
  });
}

async function exported(format: "json" | "csv"): Promise<string> {
  const download = await app.downloadTraceExport({
    request: {
      projectId: reader,
      mode: "full",
      format,
      startDate: WINDOW.from,
      endDate: WINDOW.to,
      filters: {},
    },
    userId: "sam",
    authorization: proof(),
  });
  const chunks: Uint8Array[] = [];
  for await (const chunk of download.stream) chunks.push(chunk);
  return Buffer.concat(chunks).toString("utf8");
}

const facet = (facetKey: string) =>
  app.readFacetValues({
    authorization: proof(),
    timeRange: WINDOW,
    facetKey,
    limit: 50,
    offset: 0,
  });
const json = (value: unknown) => JSON.stringify(value);
const ownSpan = `"span_id":"reader-root"`;
const ownTrace = `"trace_id":"${traceId}"`;

/** Each answer a surface gives sam, beside what in it shows the orchestrator's own data. */
type Answers = (readonly [answer: string, ownMark: string])[];
const surfaces: Record<string, () => Promise<Answers>> = {
  "the trace list and its totals": async () => {
    const page = json(await explorerList(""));
    return [
      [page, `"traceId":"${traceId}"`],
      [page, `"totalCost":0.25`],
      [page, `"totalTokens":14`],
      [page, `"spanCount":1`],
      [page, `"totalHits":1`],
    ];
  },
  "search and filters": async () => [
    [json(await explorerList("span.attribute.reader:own")), `"traceId":"${traceId}"`],
    [json(await facet("spanName")), `"value":"reader_agent"`],
    [json(await facet("spanAttributeKeys")), `"value":"reader"`],
  ],
  "the REST trace API": async () => {
    const door = restDoor();
    return [
      [await door.get("json"), ownSpan],
      [await door.search({ format: "json", includeSpans: true }), ownSpan],
    ];
  },
  "the MCP server": async () => {
    const door = restDoor();
    return [
      [await door.get("digest"), "reader_agent"],
      [await door.search({ format: "digest" }), ownTrace],
    ];
  },
  "a trace export": async () => [
    [await exported("json"), ownSpan],
    [await exported("csv"), ",reader-root,"],
  ],
  Langy: async () => {
    const door = restDoor();
    return [
      [await door.get("json"), ownSpan],
      [await door.search({ format: "json", pageSize: 25 }), ownTrace],
    ];
  },
};

beforeAll(async () => {
  if (!clickHouseConfigured) return;
  ch = await startMigratedTraceClickHouse();
  app = composeApp();
  await ch.insert({
    table: "trace_summaries",
    values: [
      summaryRow({ tenantId: reader, cost: 0.25, tokens: 7 }),
      summaryRow({ tenantId: owner, cost: 99, tokens: 900 }),
    ],
    format: "JSONEachRow",
    clickhouse_settings: settings,
  });
  await ch.insert({
    table: "stored_spans",
    values: [
      spanRow({
        tenantId: reader,
        spanId: "reader-root",
        name: "reader_agent",
        service: "reader-service",
        attributes: { reader: "own" },
      }),
      spanRow({
        tenantId: owner,
        spanId: "owner-web",
        name: "specialist_secret_agent",
        service: "specialist-service",
        attributes: { orchestrator: "web", specialist: "only" },
      }),
    ],
    format: "JSONEachRow",
    clickhouse_settings: settings,
  });
}, 120_000);

afterAll(async () => {
  if (!ch) return;
  for (const table of ["trace_summaries", "stored_spans"]) {
    await ch.exec({
      query: `ALTER TABLE ${table} DELETE WHERE TenantId IN ({reader:String}, {owner:String})`,
      query_params: { reader, owner },
    });
  }
});

describe.skipIf(!clickHouseConfigured)("surfaces outside the trace view under a braid", () => {
  describe("given an orchestrator trace holding a braided span", () => {
    describe.each(Object.entries(surfaces))("when sam reads it through %s", (_surface, read) => {
      /** @scenario "<surface> shows only the project's own spans" */
      it("reads the orchestrator's own spans and none of the owner's", async () => {
        for (const [answer, ownMark] of await read()) {
          expect(answer).toContain(ownMark);
          for (const mark of [...OWNER_MARKS, owner]) expect(answer).not.toContain(mark);
        }
      });
    });

    describe("when sam filters the list on an attribute only the owner's span carries", () => {
      /** @scenario "<surface> shows only the project's own spans" */
      it("lists no trace", async () => {
        const page = await explorerList("span.attribute.specialist:only");

        expect(page.items).toEqual([]);
      });
    });
  });
});
