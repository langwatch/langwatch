/**
 * The observability half of the packaged record, served by the API process.
 *
 * What this pins is what the migration turns on for the trace group: all
 * sixteen namespaces built on THIS process's root, with THIS process's policy
 * chain, reachable over the real `/api/trpc` handler — and the two
 * subscriptions inside the record, watchable over the real `/api/sse` lane.
 *
 * One procedure per namespace, over fakes at the ports. That is one call per
 * namespace rather than per procedure on purpose: a namespace is either in the
 * record or it does not exist, and the shape of every procedure inside it is
 * its own feature package's suite to hold.
 *
 * The last two suites are about the composition rather than the record: what a
 * process that composed NO trace read stack answers (each read refuses by name,
 * both subscriptions still stream), and that the absence is written down rather
 * than discovered by clicking into it.
 */
import { EventEmitter } from "node:events";
import type { AuthzGrantsService, AuthzService } from "@langwatch/authz-contract";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { PrismaConnection } from "@langwatch/prisma-client";
import type { PresenceEmitterPort } from "@langwatch/presence-server";
import type { ProjectService } from "@langwatch/project-contract";
import { TraceApp, type TraceAppDependencies } from "@langwatch/trace-server";
import superjson from "superjson";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ApiApplication } from "../../api.application";
import { ApiRestSecurity } from "../../api-rest.security";
import type { AnyApiTrpcCollaborators } from "../../app-trpc/app-trpc.collaborators";
import type { ApiTrpcFeatureApplication } from "../../app-trpc/app-trpc.context";
import type { AnyAppTraceGroupTrpcPorts } from "../../app-trpc/app-trpc.trace-group";
import { createSseSubscriptionApp } from "../../app-trpc/app-trpc.sse";
import { ApiRestObservabilityComposition } from "../api-rest-observability.composition";
import { ApiTrpcFeaturesComposition } from "../api-trpc-features.composition";
import {
  composeApiTraceGroupCollaborators,
  LoggedApiTraceGroupAbsence,
  type ApiTraceReadStackPort,
} from "../api-trpc-collaborators.trace-group.composition";
import { ApiRateLimitInfrastructure } from "../../platform/infrastructure/api-rate-limit.infrastructure";
import { resolveDataPrivacy } from "@langwatch/data-privacy-contract";
import { composeApiModelProviderHost } from "../api-model-provider-host.composition";
import { composeApiStudioHost } from "../api-studio-host.composition";
import { composeApiTraceReadStack } from "../api-trace-read-stack.composition";
import { composeApiPlanProvider, composeApiUsageStats } from "../api-usage.composition";
import {
  HttpWorkflowStudioStreamAdapter,
  WorkflowStudioDispatchService,
} from "@langwatch/workflow-server";

/**
 * The sixteen namespaces this half owns, as the wire names them.
 *
 * Written out rather than derived from the record under test: derived, the
 * assertion would pass for whatever the record happened to contain, including
 * a record that had silently lost half its surfaces.
 */
const TRACE_GROUP_NAMESPACES = [
  "costs",
  "httpProxy",
  "limits",
  "llmModelCost",
  "modelProvider",
  "pinnedTrace",
  "plan",
  "savedViews",
  "share",
  "sharedTrace",
  "spans",
  "topics",
  "traceEditOverlay",
  "traces",
  "tracesV2",
  "translate",
] as const;

const noop = () => undefined;

/** A schema that accepts whatever a test sends it. */
const anySchema = z.any();

/**
 * A port group whose members refuse by name unless the test named them.
 *
 * The `buildTime` split matters for the same reason it does in the record's own
 * suite: a router is assembled at composition time, so a schema that threw on
 * property access would fail the MOUNT rather than the call, and the test could
 * not tell a missing port from an unexercised one.
 */
function stub<T>(group: string, buildTime: Record<string, unknown> = {}): T {
  return new Proxy(buildTime, {
    get(target, property) {
      if (property in target) return target[property as string];
      return () => {
        throw new Error(`the test reached ${group}.${String(property)}, which it does not stub`);
      };
    },
    has: () => true,
  }) as T;
}

const trace = {
  trace_id: "trace-1",
  project_id: "project-1",
  spans: [
    { span_id: "span-b", timestamps: { started_at: 20, finished_at: 30 } },
    { span_id: "span-a", timestamps: { started_at: 10, finished_at: 40 } },
  ],
};

const overlay = { traceId: "trace-1", patch: { trace: {} }, updatedAt: new Date(0) };

/** The trace readers `TraceApp` is composed from, as far as this suite drives them. */
function testTraceReaders(): TraceAppDependencies["traces"] {
  return stub<TraceAppDependencies["traces"]>("traces", {
    read: {
      getById: async () => trace,
      getTracesWithSpans: async () => [trace],
    },
    list: { getNewCount: async () => 7 },
    editOverlay: { getByTraceId: async () => overlay },
    summary: { getByTraceId: async () => ({ redactedByVisibilityWindow: false }) },
  });
}

/** The process's broadcast fabric, with the emitter the suite drives by hand. */
function testBroadcast() {
  const emitters = new Map<string, EventEmitter>();
  const broadcast = {
    getTenantEmitter: (tenantId: string) => {
      const existing = emitters.get(tenantId);
      if (existing) return existing;
      const created = new EventEmitter();
      emitters.set(tenantId, created);
      return created;
    },
    cleanupTenantEmitter: () => undefined,
  } as unknown as PresenceEmitterPort;
  return { broadcast, emitterFor: (tenantId: string) => broadcast.getTenantEmitter(tenantId) };
}

function testTraceApp(broadcast: PresenceEmitterPort): TraceApp {
  return TraceApp.create({
    traces: testTraceReaders(),
    topics: { getAll: async () => [{ id: "topic-1", name: "Refunds", parentId: null }] },
    broadcast: broadcast as unknown as TraceAppDependencies["broadcast"],
    evaluations: stub<TraceAppDependencies["evaluations"]>("evaluations"),
    codingAgents: stub<TraceAppDependencies["codingAgents"]>("codingAgents"),
    share: stub<TraceAppDependencies["share"]>("share"),
    projects: { tryGetById: async () => null },
  });
}

/** The six application slices this half fills, plus the ones the record needs. */
function testApplication(broadcast: PresenceEmitterPort): ApiTrpcFeatureApplication {
  return {
    ...stub<ApiTrpcFeatureApplication>("app"),
    ops: { isAdmin: () => true },
    monitors: stub("app.monitors"),
    storedObjectApp: stub("app.storedObjectApp"),
    config: {},
    broadcast,
    traces: testTraceApp(broadcast),
    share: { listForResource: async () => [{ id: "share-1", token: "tok" }] },
    dataRetention: { listByProject: async () => [{ traceId: "trace-1" }] },
    topics: { getAll: async () => [{ id: "topic-1", name: "Refunds" }] },
    modelProviders: {
      getForProject: async () => ({}),
      listCosts: async () => [{ id: "cost-1", model: "gpt-5-mini" }],
    },
    planProvider: { getActivePlan: async () => ({ type: "OPEN_SOURCE", name: "Developer" }) },
  } as unknown as ApiTrpcFeatureApplication;
}

/** The group's ports, every one of them a fake this suite can observe. */
function testTraceGroupPorts(): AnyAppTraceGroupTrpcPorts {
  const protections = { visibilityCutoffMs: null, canSeeCosts: true };
  return {
    traces: stub("traces", {
      listInputSchema: anySchema,
      filterInputSchema: anySchema,
      evaluatorTypeSchema: anySchema,
      preconditionSchema: anySchema,
      getViewerProtections: async () => protections,
    }),
    tracesV2: stub("tracesV2", { getViewerProtections: async () => protections }),
    spans: { getViewerProtections: async () => protections },
    traceEditOverlay: stub("traceEditOverlay", {
      getViewerProtections: async () => protections,
      redactPatchForViewer: ({ patch }: { patch: unknown }) => patch,
      restoreWithheldEdits: ({ incoming }: { incoming: unknown }) => incoming,
    }),
    sharedTrace: stub("sharedTrace", {
      mappers: {},
      rateLimit: async () => ({ allowed: true }),
      getClientIp: () => "127.0.0.1",
      isTraceNotFound: () => false,
      tryGetShareViewerProtections: async () => null,
    }),
    savedViews: { savedViews: stub("savedViews", { getAll: async () => [{ id: "view-1" }] }) },
    costs: { readOrganizationSpend: async () => [{ project: { id: "project-1" }, costs: [] }] },
    llmModelCost: stub("llmModelCost", { isSafeRegex: () => true, getModelLimits: () => null }),
    modelProvider: stub("modelProvider", { recordAudit: () => undefined }),
    modelProviderChecks: {
      tenantWrite: () => passthroughCheck,
      credentialProbe: passthroughCheck,
    },
    translate: { wrapAiCall: (_feature: unknown, call: () => unknown) => call() },
    httpProxy: stub("httpProxy"),
    limits: stub("limits", { getUsageStats: async () => ({ currentMonthMessagesCount: 3 }) }),
  } as unknown as AnyAppTraceGroupTrpcPorts;
}

/**
 * A custom check that lets the call through and marks it checked.
 *
 * The two real gates are the composition's own, and their refusal path is that
 * composition's suite; here they only have to satisfy the fail-closed backstop
 * so the surface under test is the ROUTER rather than the gate.
 */
const passthroughCheck = Object.assign(
  async ({ ctx, next }: { ctx: { permissionChecked?: boolean }; next(): unknown }) => {
    ctx.permissionChecked = true;
    return next();
  },
  {
    authzDeclaration: {
      kind: "custom" as const,
      reason: "the suite drives the router, not the tenant gate",
      permissions: ["project:update" as const],
    },
  },
);

/** Permits everything: the refusal path is the declared check's own suite. */
function testAuthz(): AuthzService {
  return {
    hasPermission: async () => true,
    getDecision: async () => ({ permitted: true, organizationRole: null }),
    getProjectAnyDecision: async () => ({ permitted: true, organizationRole: null }),
    checkScopeLineage: async () => ({ kind: "consistent" }),
  } as unknown as AuthzService;
}

function testCollaborators(broadcast: PresenceEmitterPort): AnyApiTrpcCollaborators {
  return {
    application: testApplication(broadcast),
    analytics: {
      reads: stub("analytics.reads", {
        timeseriesInputSchema: anySchema,
        sharedFiltersSchema: anySchema,
        filterFieldSchema: anySchema,
      }),
      workbench: stub("analytics.workbench", {
        requireWorkbenchEnabled: <T>(p: T) => p,
        maxStatementLength: 4_000,
        timeWindowSchema: anySchema,
        granularityStepSchema: anySchema,
      }),
      savedCharts: stub("analytics.savedCharts", {
        requireWorkbenchEnabled: <T>(p: T) => p,
        timeWindowSchema: anySchema,
        granularityStepSchema: anySchema,
      }),
    },
    annotation: stub("annotation"),
    auth: stub("auth"),
    bugReports: stub("bugReports"),
    dataPrivacy: stub("dataPrivacy"),
    evaluations: stub("evaluations", { mappingsSchema: anySchema }),
    experiments: stub("experiments", { workbenchStateSchema: anySchema }),
    graphs: stub("graphs", { filterFieldSchema: anySchema }),
    group: stub("group"),
    batchRecord: stub("batchRecord"),
    dataset: stub("dataset"),
    evaluators: stub("evaluators"),
    home: stub("home"),
    identity: stub("identity"),
    integrationsChecks: stub("integrationsChecks"),
    joinRequests: stub("joinRequests"),
    onboarding: stub("onboarding", { signUpDataSchema: anySchema }),
    prompts: stub("prompts"),
    role: stub("role", { customRolePermission: anySchema }),
    team: stub("team"),
    // The three product-infrastructure surfaces, as one entry. Only the
    // monitor precondition parser is read while the record is BUILT; the
    // retention policy and the rest refuse by name if a call reaches them.
    productInfra: {
      dataRetention: stub("productInfra.dataRetention"),
      monitors: stub("productInfra.monitors", { preconditionsSchema: anySchema }),
    },
    /**
     * The nine tenant-administration surfaces, stubbed with only what the
     * record reads while it is BUILT: the sign-up questionnaire the
     * organization ceremony parses against, and the three data-dependent gates
     * the mounts chain onto a procedure. Their own suite is what proves they
     * answer.
     */
    orgGroup: {
      organization: stub("orgGroup.organization", {
        signUpDataSchema: anySchema,
        isCustomRole: () => false,
      }),
      organizationAuditLogCheck: passthroughCheck,
      project: stub("orgGroup.project"),
      projectChecks: { create: passthroughCheck, traceSharing: passthroughCheck },
      codingAgents: stub("orgGroup.codingAgents"),
      automation: stub("orgGroup.automation", {
        providers: stub("orgGroup.automation.providers"),
      }),
      emailSuppression: stub("orgGroup.emailSuppression"),
      enterprise: {
        scimToken: stub("orgGroup.enterprise.scimToken"),
        ssoConnections: stub("orgGroup.enterprise.ssoConnections"),
      },
    },
    traceGroup: testTraceGroupPorts(),
    /**
     * The six agent surfaces, stubbed with only what the record reads while it
     * is being BUILT. Their own suite is what proves they answer.
     */
    /**
     * The twenty-one gateway and governance surfaces, stubbed with only what
     * the record reads while it is BUILT: the virtual-key budget parser and
     * the SaaS-billing decision, which chooses which router the two billing
     * namespaces ARE. Their own suite is what proves they answer.
     */
    gatewayGroup: {
      gateway: { virtualKeys: { virtualKeyBudgetInput: anySchema } },
      governanceHome: stub("gatewayGroup.governanceHome"),
      saasBilling: false,
    },
    github: stub("github"),
    agentGroup: {
      scenarios: stub("agentGroup.scenarios"),
      langy: stub("agentGroup.langy"),
      langyGates: {
        refuseDemoProject: passthroughCheck,
        enforceLangyAccess: passthroughCheck,
      },
      langyEgress: stub("agentGroup.langyEgress"),
      ops: stub("agentGroup.ops"),
      // Read at BUILD time — the mount asks it for a middleware — so it
      // answers one rather than being one.
      opsCheck: () => passthroughCheck,
    },
    user: stub("user"),
    workflows: {
      lifecycle: stub("workflows.lifecycle"),
      optimization: stub("workflows.optimization"),
    },
  } as unknown as AnyApiTrpcCollaborators;
}

/** A REST security whose credential services are never reached on this lane. */
function subscriptionSecurity() {
  return ApiRestSecurity.create({
    apiKeys: stub("apiKeys"),
    authz: stub("authz"),
    organizations: stub("organizations"),
    observability: ApiRestObservabilityComposition.create(),
  } as never);
}

function composeApplication() {
  const { broadcast, emitterFor } = testBroadcast();
  const features = ApiTrpcFeaturesComposition.tryCompose({
    database: { client: {} as unknown as PrismaClient } as unknown as PrismaConnection,
    authz: testAuthz(),
    audit: undefined,
    collaborators: testCollaborators(broadcast),
  });
  if (!features) throw new Error("the record refused to compose against its test collaborators");

  const session = { user: { id: "user-1", email: "person@example.com" } };
  const application = ApiApplication.create({
    features,
    http: {
      createContext: async () => ({
        actor: () => ({ id: "user-1" }),
        tryActor: () => ({ id: "user-1" }),
        authorize: async () => undefined,
        session,
      }),
      subscriptions: (ports) =>
        createSseSubscriptionApp({
          security: subscriptionSecurity(),
          ports,
          // The suite ENDS each stream by aborting it, which is a stream
          // failure as far as the lane is concerned. Silenced so a deliberate
          // teardown does not print a stack per subscription assertion.
          logger: { debug: noop, info: noop, warn: noop, error: noop },
        }).hono,
    },
  });

  return { application, emitterFor };
}

async function callTrpc(
  application: ApiApplication,
  path: string,
  input: Record<string, unknown>,
): Promise<{ status: number; body: unknown }> {
  if (!application.hono) throw new Error("HTTP composition was not created.");
  const encoded = encodeURIComponent(JSON.stringify({ json: input }));
  const response = await application.hono.request(
    `http://127.0.0.1/api/trpc/${path}?input=${encoded}`,
  );
  return { status: response.status, body: await response.json() };
}

/**
 * Drives one subscription: opens the stream, waits for the procedure's own
 * listener to attach, emits one event, and reads the frames back.
 *
 * The wait is on the LISTENER rather than on a timer because a tRPC
 * subscription's generator body only runs on the first pull, so an event
 * emitted before that lands on nobody and the test would hang for a reason
 * that has nothing to do with the wiring.
 */
async function watchSse(options: {
  application: ApiApplication;
  path: string;
  input: Record<string, unknown>;
  emitter: EventEmitter;
  channel: string;
  event: unknown;
}) {
  const { application, path, input, emitter, channel, event } = options;
  if (!application.hono) throw new Error("HTTP composition was not created.");

  const controller = new AbortController();
  const encoded = encodeURIComponent(superjson.stringify(input));
  const response = await application.hono.request(
    `http://127.0.0.1/api/sse/${path}?input=${encoded}`,
    { signal: controller.signal },
  );

  await vi.waitFor(() => {
    if (emitter.listenerCount(channel) === 0) throw new Error("no listener yet");
  });
  emitter.emit(channel, event);

  const reader = response.body?.getReader();
  if (!reader) throw new Error("the subscription answered no stream");
  const decoder = new TextDecoder();
  const frames: unknown[] = [];
  let buffered = "";
  try {
    while (frames.length < 2) {
      const chunk = await reader.read();
      if (chunk.done) break;
      buffered += decoder.decode(chunk.value, { stream: true });
      const blocks = buffered.split("\n\n");
      buffered = blocks.pop() ?? "";
      for (const block of blocks) {
        const payload = block
          .split("\n")
          .filter((line) => line.startsWith("data: "))
          .map((line) => line.slice("data: ".length))
          .join("\n");
        if (payload.length > 0) frames.push(superjson.parse(payload));
      }
    }
  } finally {
    controller.abort();
    await reader.cancel().catch(() => undefined);
  }

  return { status: response.status, contentType: response.headers.get("Content-Type"), frames };
}

describe("given an API process composed with the observability collaborators", () => {
  it("mounts all sixteen of its namespaces beside the rest of the record", () => {
    const { application } = composeApplication();

    const mounted = Object.keys(
      (application.trpc as unknown as { _def: { record: Record<string, unknown> } })._def.record,
    );

    for (const namespace of TRACE_GROUP_NAMESPACES) {
      expect(mounted).toContain(namespace);
    }
  });

  describe("when one procedure of each namespace is called through the real handler", () => {
    const calls: ReadonlyArray<
      readonly [string, Record<string, unknown>, (body: unknown) => void]
    > = [
      [
        "traces.getById",
        { projectId: "project-1", traceId: "trace-1" },
        (body) => expect(body).toMatchObject({ result: { data: { json: { trace_id: "trace-1" } } } }),
      ],
      [
        "tracesV2.newCount",
        { projectId: "project-1", timeRange: { from: 0, to: 1 }, since: 0 },
        (body) => expect(body).toMatchObject({ result: { data: { json: { count: 7 } } } }),
      ],
      [
        "spans.getAllForTrace",
        { projectId: "project-1", traceId: "trace-1" },
        (body) =>
          expect(body).toMatchObject({
            // The waterfall order is the application's: earliest first, and the
            // longer of two that start together first.
            result: { data: { json: [{ span_id: "span-a" }, { span_id: "span-b" }] } },
          }),
      ],
      [
        "traceEditOverlay.getByTraceId",
        { projectId: "project-1", traceId: "trace-1" },
        (body) => expect(body).toMatchObject({ result: { data: { json: { traceId: "trace-1" } } } }),
      ],
      [
        "share.listForResource",
        { projectId: "project-1", resourceType: "TRACE", resourceId: "trace-1" },
        (body) => expect(body).toMatchObject({ result: { data: { json: [{ id: "share-1" }] } } }),
      ],
      [
        "pinnedTrace.listByProject",
        { projectId: "project-1" },
        (body) => expect(body).toMatchObject({ result: { data: { json: [{ traceId: "trace-1" }] } } }),
      ],
      [
        "savedViews.getAll",
        { projectId: "project-1" },
        (body) => expect(body).toMatchObject({ result: { data: { json: [{ id: "view-1" }] } } }),
      ],
      [
        "topics.getAll",
        { projectId: "project-1" },
        (body) => expect(body).toMatchObject({ result: { data: { json: [{ id: "topic-1" }] } } }),
      ],
      [
        "costs.getAggregatedCostsForOrganization",
        { organizationId: "org-1", startDate: 0, endDate: 1 },
        (body) =>
          expect(body).toMatchObject({
            result: { data: { json: [{ project: { id: "project-1" } }] } },
          }),
      ],
      [
        "llmModelCost.getAllForProject",
        { projectId: "project-1" },
        (body) => expect(body).toMatchObject({ result: { data: { json: [{ id: "cost-1" }] } } }),
      ],
      [
        "modelProvider.getAllForProject",
        { projectId: "project-1" },
        (body) => expect(body).toMatchObject({ result: { data: { json: {} } } }),
      ],
      [
        "limits.getUsage",
        { organizationId: "org-1" },
        (body) =>
          expect(body).toMatchObject({
            result: { data: { json: { currentMonthMessagesCount: 3 } } },
          }),
      ],
      [
        "plan.getActivePlan",
        { organizationId: "org-1" },
        (body) => expect(body).toMatchObject({ result: { data: { json: { name: "Developer" } } } }),
      ],
    ];

    for (const [path, input, assertBody] of calls) {
      it(`answers ${path}`, async () => {
        const { application } = composeApplication();

        const { status, body } = await callTrpc(application, path, input);

        expect(status).toBe(200);
        assertBody(body);
      });
    }
  });

  describe("when the anonymous share read is called with no session at all", () => {
    it("still resolves it on the public procedure, and refuses the token", async () => {
      const { application } = composeApplication();

      // The token is rejected by the share ledger the stub refuses on, which is
      // the point: what is under test is that ADR-057's public surface is
      // MOUNTED and reachable, not what a valid token resolves to.
      const { status, body } = await callTrpc(application, "sharedTrace.get", { token: "nope" });

      expect(status).toBeGreaterThanOrEqual(400);
      expect(JSON.stringify(body)).toContain("share");
    });
  });

  describe("when the two live-update subscriptions are watched over /api/sse", () => {
    it("streams a trace update on the same root the tRPC endpoint serves", async () => {
      const { application, emitterFor } = composeApplication();

      const watched = await watchSse({
        application,
        path: "traces.onTraceUpdate",
        input: { projectId: "project-1" },
        emitter: emitterFor("project-1") as unknown as EventEmitter,
        channel: "trace_updated",
        event: { traceId: "trace-1" },
      });

      expect(watched.status).toBe(200);
      expect(watched.contentType).toBe("text/event-stream; charset=utf-8");
      expect(watched.frames[0]).toEqual({ type: "connected" });
      expect(watched.frames[1]).toMatchObject({ traceId: "trace-1" });
    });

    it("streams a facet recomputation the same way", async () => {
      const { application, emitterFor } = composeApplication();

      const watched = await watchSse({
        application,
        path: "tracesV2.onDiscoverUpdate",
        input: { projectId: "project-1" },
        emitter: emitterFor("project-1") as unknown as EventEmitter,
        channel: "discover_updated",
        event: { facets: 3 },
      });

      expect(watched.status).toBe(200);
      expect(watched.frames[0]).toEqual({ type: "connected" });
      expect(watched.frames[1]).toMatchObject({ facets: 3 });
    });
  });
});

describe("given a process that composed no trace read stack", () => {
  function composeGroup(report?: LoggedApiTraceGroupAbsence) {
    const { broadcast, emitterFor } = testBroadcast();
    const group = composeApiTraceGroupCollaborators({
      prisma: {} as unknown as PrismaClient,
      authz: testAuthz(),
      grants: stub<AuthzGrantsService>("grants"),
      projects: stub<ProjectService>("projects"),
      organizations: stub("organizations"),
      broadcast,
      defaultRetentionDays: 49,
      resolveClickHouseClient: null,
      redis: null,
      // Permissive here on purpose: this suite is about what a process with no
      // read stack REFUSES. The counter's own behaviour is the last suite.
      rateLimit: async () => ({ allowed: true }),
      modelProviders: undefined,
      processName: "langwatch-api",
      ...(report ? { report } : {}),
    });
    return { group, emitterFor };
  }

  it("refuses every trace read by name rather than answering an empty one", async () => {
    const { group } = composeGroup();

    await expect(
      group.ports.traces.getViewerProtections({}, { projectId: "project-1" }),
    ).rejects.toMatchObject({ code: "service_unavailable" });
  });

  it("still hands out the tenant emitter both subscriptions stream off", () => {
    const { group, emitterFor } = composeGroup();

    expect(group.traces.getTenantEmitter("project-1")).toBe(emitterFor("project-1"));
  });

  it("answers a cost-rule pattern conservatively rather than allowing everything", () => {
    const { group } = composeGroup();

    expect(group.ports.llmModelCost.isSafeRegex("^gpt-5")).toBe(true);
    expect(group.ports.llmModelCost.isSafeRegex("(a+)+$")).toBe(false);
  });

  it("names every capability it did not compose", () => {
    const warn = vi.fn();

    composeGroup(LoggedApiTraceGroupAbsence.create({ warn }));

    expect(warn.mock.calls.map(([data]) => (data as { capability: string }).capability)).toEqual([
      "trace-reads",
      "model-provider-host",
      "studio",
      "usage",
      "plans",
    ]);
  });
});

/**
 * A Prisma double whose every model answers the shape its caller reads.
 *
 * A table rather than a class: the reads below touch eight models across three
 * packages, and writing a stub per model would be eight declarations of
 * somebody else's query. Anything not named answers empty, which is a real
 * answer for a tenant with no rows rather than a refusal.
 */
function testPrisma(rows: Record<string, Record<string, unknown>> = {}): PrismaClient {
  const defaults: Record<string, Record<string, unknown>> = {
    project: { findMany: [], findUnique: null },
    organization: { findUnique: { pricingModel: null } },
    organizationUser: { findMany: [] },
    organizationInvite: { findMany: [] },
    customRole: { findMany: [] },
    team: { findMany: [] },
    roleBinding: { findMany: [] },
    cost: { aggregate: { _sum: { amount: null } }, groupBy: [] },
  };
  const answers = { ...defaults, ...rows };
  return new Proxy(
    {},
    {
      get: (_target, model) =>
        new Proxy(
          {},
          {
            get: (_inner, method) => async () => {
              const forModel = answers[String(model)];
              if (!forModel || !(String(method) in forModel)) return null;
              return forModel[String(method)];
            },
          },
        ),
      has: () => true,
    },
  ) as unknown as PrismaClient;
}

/**
 * The process's ClickHouse, answering one canned result set per query shape.
 *
 * Matched on a fragment of the SQL rather than on the whole statement: the
 * statements are hundreds of characters of generated SQL, and a test that
 * pinned them would fail on every formatting change without ever noticing a
 * behavioural one.
 */
function testClickHouse(answers: ReadonlyArray<readonly [string, unknown[]]>) {
  const queries: string[] = [];
  const client = {
    query: async ({ query }: { query: string }) => {
      queries.push(query);
      const matched = answers.find(([fragment]) => query.includes(fragment));
      return { json: async () => matched?.[1] ?? [] };
    },
  };
  return {
    queries,
    resolveClient: async () => client as never,
  };
}

describe("given an API process that composed the real observability collaborators", () => {
  const plans = composeApiPlanProvider({ isSaas: false });

  function composeRealGroup(clickHouse: ReturnType<typeof testClickHouse>) {
    const { broadcast } = testBroadcast();
    const prisma = testPrisma();
    return composeApiTraceGroupCollaborators({
      prisma,
      authz: testAuthz(),
      grants: stub<AuthzGrantsService>("grants"),
      projects: {
        tryGetWithTeam: async () => ({ id: "project-1", team: { organizationId: "org-1" } }),
        tryGetById: async () => ({ id: "project-1" }),
      } as unknown as ProjectService,
      organizations: stub("organizations"),
      broadcast,
      defaultRetentionDays: 49,
      resolveClickHouseClient: clickHouse.resolveClient,
      redis: null,
      // As above: this suite drives the ClickHouse reads, not the anonymous
      // share read's throttle.
      rateLimit: async () => ({ allowed: true }),
      modelProviders: undefined,
      processName: "langwatch-api",
      traceReadsFrom: ({ dataRetention, topics }) =>
        composeApiTraceReadStack({
          prisma,
          resolveClickHouseClient: clickHouse.resolveClient,
          authz: testAuthz(),
          projects: {
            tryGetWithTeam: async () => ({ id: "project-1", team: { organizationId: "org-1" } }),
            tryGetById: async () => ({ id: "project-1" }),
          } as unknown as ProjectService,
          // The PLATFORM's own default policy, resolved by the real resolver
          // against an empty rule set: a hand-written policy shape here would
          // be a second declaration of Data Privacy's own contract.
          dataPrivacy: {
            getResolvedForProject: async () =>
              resolveDataPrivacy({
                rows: [],
                facts: {
                  organizationId: "org-1",
                  teamId: "team-1",
                  projectId: "project-1",
                  departmentId: null,
                  isPersonal: false,
                },
              }),
          },
          plans,
          dataRetention,
          topics,
          modelProviders: undefined,
          executionProxyBaseUrl: "http://127.0.0.1:5561",
          processName: "langwatch-api",
        }),
      modelProviderHost: composeApiModelProviderHost({
        egress: { blockLocal: true, allowedHosts: [], verifyTls: true },
        environment: {},
        processName: "langwatch-api",
      }),
      studio: composeApiStudioHost({
        nlpServiceUrl: undefined,
        modelProviders: undefined,
        processName: "langwatch-api",
      }),
      usage: composeApiUsageStats({
        prisma,
        plans,
        resolveClickHouseClient: clickHouse.resolveClient,
        processName: "langwatch-api",
      }),
      plans,
    });
  }

  /** The record, with the observability half composed for real. */
  function composeRealApplication(clickHouse: ReturnType<typeof testClickHouse>) {
    const { broadcast } = testBroadcast();
    const group = composeRealGroup(clickHouse);
    const collaborators = {
      ...testCollaborators(broadcast),
      traceGroup: group.ports,
      application: {
        ...testApplication(broadcast),
        traces: group.traces,
        share: group.share,
        dataRetention: group.dataRetention,
        topics: group.topics,
        modelProviders: group.modelProviders,
        planProvider: group.planProvider,
      } as unknown as ApiTrpcFeatureApplication,
    } as AnyApiTrpcCollaborators;

    const features = ApiTrpcFeaturesComposition.tryCompose({
      database: { client: {} as unknown as PrismaClient } as unknown as PrismaConnection,
      authz: testAuthz(),
      audit: undefined,
      collaborators,
    });
    if (!features) throw new Error("the record refused to compose against its real collaborators");

    return {
      group,
      application: ApiApplication.create({
        features,
        http: {
          createContext: async () => ({
            actor: () => ({ id: "user-1" }),
            tryActor: () => ({ id: "user-1" }),
            authorize: async () => undefined,
            session: { user: { id: "user-1", email: "person@example.com" } },
          }),
        },
      }),
    };
  }

  describe("when the live-count read is called through the real handler", () => {
    it("answers the count its own ClickHouse returned rather than refusing", async () => {
      const clickHouse = testClickHouse([["SELECT count() AS cnt", [{ cnt: 12 }]]]);
      const { application } = composeRealApplication(clickHouse);

      const { status, body } = await callTrpc(application, "tracesV2.newCount", {
        projectId: "project-1",
        timeRange: { from: 0, to: 2_000_000_000_000 },
        since: 0,
      });

      expect(status).toBe(200);
      expect(body).toMatchObject({ result: { data: { json: { count: 12 } } } });
      // The read really went to this process's connection, tenant-first.
      expect(clickHouse.queries[0]).toContain("TenantId");
    });
  });

  describe("when the reader's protections are resolved for a project", () => {
    it("answers the real redactions rather than refusing by name", async () => {
      const clickHouse = testClickHouse([]);
      const group = composeRealGroup(clickHouse);

      const protections = (await group.ports.traces.getViewerProtections(
        { tryActor: () => ({ id: "user-1" }) },
        { projectId: "project-1" },
      )) as {
        canSeeCosts: boolean;
        contentCategories: Record<string, { canSee: boolean; restrictVisibleTo: string | null }>;
      };
      // No caller at all: the redactions are the anonymous reader's, which is
      // the fail-closed direction rather than the permissive one.
      const anonymous = (await group.ports.traces.getViewerProtections(
        {},
        { projectId: "project-1" },
      )) as { canSeeCosts: boolean };

      expect(protections).toMatchObject({ canSeeCosts: true });
      expect(protections.contentCategories.input).toMatchObject({ canSee: true });
      expect(anonymous.canSeeCosts).toBe(false);
    });
  });

  describe("when a trace's log records are read on this process", () => {
    /**
     * The one collaborator keeping `GET /api/traces/{traceId}/transcript`
     * unmounted, read through the same call the transcript join makes first.
     *
     * The stack composes the LEGACY log table for real and refuses the
     * canonical one, and canonical `log_records` is the only table still
     * taking writes — so answering from what is composed would derive an empty
     * transcript for every trace ingested since the cutover. It refuses
     * instead, and this pins that: the day a process composes the canonical
     * read, this test goes red and the transcript door can be mounted.
     */
    /** @scenario "the transcript is not served without the canonical log read it derives from" */
    it("refuses by name rather than answering the legacy table's rows alone", async () => {
      const clickHouse = testClickHouse([]);
      const group = composeRealGroup(clickHouse);

      await expect(
        group.traces.readTraceLogRecords({
          projectId: "project-1",
          traceId: "trace-1",
          occurredAtMs: 1_700_000_000_000,
        }),
      ).rejects.toMatchObject({
        code: "service_unavailable",
        meta: { capability: "the canonical log read" },
      });
    });
  });

  describe("when the legacy grid's own ports are asked for", () => {
    it("carries a real input parser and a real span digest", async () => {
      const clickHouse = testClickHouse([]);
      const group = composeRealGroup(clickHouse);

      const parsed = group.ports.traces.listInputSchema.parse({
        projectId: "project-1",
        startDate: 1_700_000_000_000,
        endDate: 1_700_000_600_000,
      });
      const digest = await group.ports.traces.formatSpansDigest([]);

      expect(parsed).toMatchObject({ projectId: "project-1" });
      expect(() =>
        group.ports.traces.listInputSchema.parse({
          projectId: "project-1",
          startDate: 1_700_000_000_000,
          endDate: 1_700_000_600_000,
          pageOffset: 3,
        }),
      ).toThrow();
      expect(typeof digest).toBe("string");
    });
  });

  describe("when a model's ceilings are read through the real handler", () => {
    it("answers the registry's own limits rather than null", async () => {
      const clickHouse = testClickHouse([]);
      const { application } = composeRealApplication(clickHouse);

      const { status, body } = await callTrpc(application, "llmModelCost.getModelLimits", {
        projectId: "project-1",
        model: "openai/gpt-5-mini",
      });

      expect(status).toBe(200);
      expect(body).toMatchObject({
        result: { data: { json: { maxInputTokens: expect.any(Number) } } },
      });
    });
  });

  describe("when a catastrophic-backtracking pattern is checked", () => {
    it("uses the package's real gate rather than the conservative stand-in", () => {
      const clickHouse = testClickHouse([]);
      const group = composeRealGroup(clickHouse);

      expect(group.ports.llmModelCost.isSafeRegex("^gpt-5")).toBe(true);
      expect(group.ports.llmModelCost.isSafeRegex("(a+)+$")).toBe(false);
    });
  });

  describe("when the usage panel and the plan banner are read through the real handler", () => {
    it("answers a real reading taken against a real plan", async () => {
      const clickHouse = testClickHouse([]);
      const { application } = composeRealApplication(clickHouse);

      const usage = await callTrpc(application, "limits.getUsage", { organizationId: "org-1" });
      const plan = await callTrpc(application, "plan.getActivePlan", { organizationId: "org-1" });

      expect(usage.status).toBe(200);
      expect(usage.body).toMatchObject({
        result: { data: { json: { membersCount: 0, activePlan: { name: expect.any(String) } } } },
      });
      expect(plan.status).toBe(200);
      expect(plan.body).toMatchObject({ result: { data: { json: { name: expect.any(String) } } } });
    });
  });

  describe("when the studio dispatches an event to an engine that answers", () => {
    it("relays the engine's own server events back to the watcher", async () => {
      const frames = [
        'data: {"type":"component_state_change","payload":{"component_id":"node-1"}}\n\n',
        'data: {"type":"done","payload":{}}\n\n',
      ];
      const encoder = new TextEncoder();
      const engine = vi.fn(async () => ({
        body: new ReadableStream<Uint8Array>({
          start(controller) {
            for (const frame of frames) controller.enqueue(encoder.encode(frame));
            controller.close();
          },
        }),
      })) as unknown as typeof fetch;

      const seen: Array<{ type: string }> = [];
      const dispatch = WorkflowStudioDispatchService.create({
        stream: HttpWorkflowStudioStreamAdapter.create({
          serviceUrl: "http://127.0.0.1:5561",
          fetch: engine,
        }),
        modelProviders: { getForProject: async () => ({}) } as never,
      });

      await dispatch.postEvent({
        projectId: "project-1",
        event: { type: "execute_flow", payload: { node_id: "node-1" } } as never,
        onEvent: (event) => seen.push(event as { type: string }),
      });

      expect(seen.map((event) => event.type)).toEqual(["component_state_change", "done"]);
    });
  });

  describe("when the studio is asked for on a process that composed no gateway", () => {
    it("refuses the dispatch by name rather than dispatching without one", async () => {
      const clickHouse = testClickHouse([]);
      const group = composeRealGroup(clickHouse);

      await expect(
        group.ports.httpProxy.postStudioEvent(undefined, {
          projectId: "project-1",
          event: { type: "is_alive", payload: {} } as never,
          onEvent: noop,
        }),
      ).rejects.toMatchObject({
        code: "service_unavailable",
        meta: { capability: "the studio event dispatch" },
      });
    });
  });
});

/**
 * The anonymous share read, over the counter this process actually keeps.
 *
 * `sharedTrace.get` is the ONE trace read the open internet can drive: no
 * credential, five ClickHouse reads and a view write per call. Trace owns the
 * ceilings (60 reads a minute per share token, 120 per client address), the
 * refusal and the customer copy; the process owns only the counter they are
 * kept in. This suite drives the real `/api/trpc` handler over the REAL
 * composed port, so a stand-in that answered "allowed" without counting —
 * which is what this process shipped — fails it.
 */
describe("given the anonymous share read composed on this process", () => {
  /** How many token-scoped reads a minute the transport allows. */
  const READS_PER_TOKEN_PER_MINUTE = 60;
  /** The address the caller presents, as a proxy forwards it. */
  const CLIENT_IP = "203.0.113.7";

  /**
   * A payload the share output contract accepts, so a read that gets past the
   * counter ANSWERS rather than failing somewhere further down and leaving
   * "not rate limited" indistinguishable from "broken".
   */
  const sharedTracePayload = () => ({
    project: {
      id: "project-1",
      name: "Project",
      slug: "project",
      language: "python",
      framework: "openai",
    },
    header: {
      traceId: "trace-1",
      timestamp: 1_700_000_000_000,
      name: "trace",
      serviceName: "svc",
      origin: "api",
      conversationId: null,
      userId: null,
      durationMs: 10,
      spanCount: 1,
      status: "ok" as const,
      models: [],
      totalCost: null,
      totalTokens: 0,
      inputTokens: null,
      outputTokens: null,
      tokensEstimated: false,
      traceName: "trace",
      rootSpanType: null,
      scenarioRunId: null,
      attributes: {},
    },
    spanTree: [],
    spansFull: [],
    spanSignals: [],
    resources: { rootSpanId: null, resourceAttributes: {}, scope: null, spans: [] },
    events: [],
    evaluations: [],
    isSpanDetailTruncated: false,
  });

  /**
   * A read stack that answers the two things the share path asks of one — the
   * viewer's redactions and the mapper ports — and refuses everything else by
   * name. The ClickHouse fan-out itself is not what this suite is about.
   */
  function shareReadStack(): ApiTraceReadStackPort {
    return stub<ApiTraceReadStackPort>("traceReads", {
      readers: () => testTraceReaders(),
      legacyPorts: () => ({
        listInputSchema: anySchema,
        filterInputSchema: anySchema,
        evaluatorTypeSchema: anySchema,
        preconditionSchema: anySchema,
      }),
      readPorts: () => ({ mappers: {} }),
      explorerPorts: () => ({}),
      editOverlayRedaction: () => ({}),
      getViewerProtections: async () => ({ visibilityCutoffMs: null, canSeeCosts: true }),
      tryGetShareViewerProtections: async () => ({
        visibilityCutoffMs: null,
        canSeeCosts: true,
      }),
      isTraceNotFound: () => false,
    });
  }

  /**
   * The record with the share read composed over a real
   * {@link ApiRateLimitInfrastructure} — no Redis, so it counts in memory,
   * which is the same arithmetic the Redis path performs.
   */
  function composeShareApplication() {
    const limiter = ApiRateLimitInfrastructure.create();
    const metered: Array<{ key: string; windowSeconds: number; max: number }> = [];
    const { broadcast } = testBroadcast();
    const group = composeApiTraceGroupCollaborators({
      prisma: testPrisma(),
      authz: testAuthz(),
      grants: stub<AuthzGrantsService>("grants"),
      projects: stub<ProjectService>("projects"),
      organizations: stub("organizations"),
      broadcast,
      defaultRetentionDays: 49,
      resolveClickHouseClient: null,
      redis: null,
      // The shape `api-production.composition.ts` passes: the process's ONE
      // counter, reached through the same one-line lambda.
      rateLimit: (input) => {
        metered.push(input);
        return limiter.consume(input);
      },
      modelProviders: undefined,
      processName: "langwatch-api",
      traceReads: shareReadStack(),
    });

    // The share resolution and the cached payload are the application's, not
    // the group's: what this suite drives is everything the transport does
    // BEFORE them, which is the throttle.
    const traces = group.traces as unknown as Record<string, unknown>;
    Object.assign(traces, {
      resolveShareForViewer: async () => ({
        resourceType: "TRACE",
        projectId: "project-1",
        resourceId: "trace-1",
      }),
      readCachedSharePayload: async () => sharedTracePayload(),
    });

    const collaborators = {
      ...testCollaborators(broadcast),
      traceGroup: group.ports,
      application: {
        ...testApplication(broadcast),
        traces,
      } as unknown as ApiTrpcFeatureApplication,
    } as AnyApiTrpcCollaborators;

    const features = ApiTrpcFeaturesComposition.tryCompose({
      database: { client: {} as unknown as PrismaClient } as unknown as PrismaConnection,
      authz: testAuthz(),
      audit: undefined,
      collaborators,
    });
    if (!features) throw new Error("the record refused to compose against its collaborators");

    return {
      metered,
      application: ApiApplication.create({
        features,
        http: {
          createContext: async () => ({
            actor: () => ({ id: "user-1" }),
            tryActor: () => undefined,
            authorize: async () => undefined,
            // No session at all: this is the surface an anonymous viewer hits.
            session: null,
          }),
        },
      }),
    };
  }

  /**
   * One anonymous read, over the wire.
   *
   * The address rides as a header rather than being injected into the context,
   * because the header is the only place it can come from: `ctx.req` is built
   * by the application from the real request.
   */
  async function readShare(
    application: ApiApplication,
    token: string,
    clientIp?: string,
  ): Promise<{ status: number; body: unknown }> {
    if (!application.hono) throw new Error("HTTP composition was not created.");
    const encoded = encodeURIComponent(JSON.stringify({ json: { token } }));
    const response = await application.hono.request(
      `http://127.0.0.1/api/trpc/sharedTrace.get?input=${encoded}`,
      clientIp ? { headers: { "x-forwarded-for": clientIp } } : {},
    );
    return { status: response.status, body: await response.json() };
  }

  /**
   * The handled error's code as the wire carries it, or `null` where the call
   * succeeded. superjson wraps every payload, errors included, so the
   * serialized handled error sits under `error.json.data.error`.
   */
  function handledCodeOf(body: unknown): string | null {
    return (
      (body as { error?: { json?: { data?: { error?: { code?: string } } } } }).error?.json?.data
        ?.error?.code ?? null
    );
  }

  describe("when a share link is opened inside its window", () => {
    /** @scenario "An anonymous share read is metered against the process's own counter" */
    it("answers the share payload rather than refusing", async () => {
      const { application } = composeShareApplication();

      const { status, body } = await readShare(application, "share-token-1", CLIENT_IP);

      expect(status).toBe(200);
      expect(body).toMatchObject({
        result: { data: { json: { header: { traceId: "trace-1" } } } },
      });
    });

    /** @scenario "An anonymous share read is metered against the process's own counter" */
    it("counts the read against both the share token and the caller's address", async () => {
      const { application, metered } = composeShareApplication();

      await readShare(application, "share-token-1", CLIENT_IP);

      expect(metered).toEqual([
        { key: "sharedTrace:token:share-token-1", windowSeconds: 60, max: 60 },
        { key: `sharedTrace:ip:${CLIENT_IP}`, windowSeconds: 60, max: 120 },
      ]);
    });
  });

  describe("when one share token is read past its per-minute ceiling", () => {
    /** @scenario "A share link read past its ceiling is refused with the code its copy is written for" */
    it("refuses with share_read_rate_limited once the token's window is spent", async () => {
      const { application } = composeShareApplication();

      for (let read = 0; read < READS_PER_TOKEN_PER_MINUTE; read += 1) {
        const allowed = await readShare(application, "share-token-1", CLIENT_IP);
        expect(allowed.status).toBe(200);
      }

      const { status, body } = await readShare(application, "share-token-1", CLIENT_IP);

      // The code, not the prose: the copy a customer reads is registered
      // against this code, and the prose is free to change.
      expect(handledCodeOf(body)).toBe("share_read_rate_limited");
      expect(status).toBe(429);
    });

    /** @scenario "A share link read past its ceiling is refused with the code its copy is written for" */
    it("leaves a second share token's own window untouched", async () => {
      const { application } = composeShareApplication();

      for (let read = 0; read <= READS_PER_TOKEN_PER_MINUTE; read += 1) {
        await readShare(application, "share-token-1", CLIENT_IP);
      }

      const { status, body } = await readShare(application, "share-token-2", CLIENT_IP);

      expect(handledCodeOf(body)).toBeNull();
      expect(status).toBe(200);
    });
  });
});
