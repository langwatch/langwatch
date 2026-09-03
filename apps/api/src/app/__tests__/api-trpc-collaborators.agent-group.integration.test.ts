/**
 * The agent-group half of the packaged tRPC record, served by the API process.
 *
 * What this pins is one call per namespace this half mounts, each of them made
 * over the REAL `/api/trpc` handler on THIS process's root, through THIS
 * process's policy chain, against the collaborator set
 * `composeApiAgentGroupCollaborators` produced. Nothing here reaches a stub
 * through a proxy: the fakes are at the PORTS — a Prisma double, an AuthZ
 * service, a flag store and a broadcast fabric — and everything between the
 * HTTP request and them is the real composed graph.
 *
 *   scenarios.getAll        the composed `PrismaScenarioAdapter`, with the
 *                           project scope and the archived filter observable
 *                           rather than assumed
 *   suites.getAll           the composed `PostgresSuiteAdapter` over the same
 *                           connection
 *   langy.list              the composed `PostgresLangyAdapter`'s conversation
 *                           projection, narrowed to the caller
 *   langyEgress.get         the same Langy application, through both gates
 *   ops.getScope            the operator gate resolving this process's own
 *                           admin allow-list, including the probe variant that
 *                           REPORTS "no access" instead of refusing
 *   setupSkills.getPrompt   the moved catalogue, answering a real skill body
 *
 * And the three subscriptions, driven end to end over the real `/api/sse` lane
 * on the same root — which is the whole point of putting them inside the record
 * rather than beside it.
 *
 * Finally the named absences, because an absence nobody can observe is
 * indistinguishable from a stub: with no queue registered, starting a scenario
 * run and starting a Langy turn are refused BY NAME rather than silently
 * dropped, and a caller who is not on the allow-list is refused by the operator
 * gate rather than shown the back office.
 */
import type { EventEmitter } from "node:events";
import { EventEmitter as NodeEventEmitter } from "node:events";
import { createTenantId, EventSourcing } from "@langwatch/eventing";
import { EventStoreMemory } from "@langwatch/eventing/testing";
import type { AuthService } from "@langwatch/auth-contract";
import type {
  AuthzGetDecisionInput,
  AuthzScopeLineageResult,
  AuthzService,
  PermissionDecision,
} from "@langwatch/authz-contract";
import { AgentNotFoundError, type AgentService } from "@langwatch/agent-contract";
import type { ModelProviderService } from "@langwatch/model-provider-contract";
import type { FeatureFlagService } from "@langwatch/feature-flag-contract";
import type { OrganizationService } from "@langwatch/organization-contract";
import type { PresenceEmitterPort } from "@langwatch/presence-server";
import type { PrismaConnection } from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { ProjectService } from "@langwatch/project-contract";
import type { SecretService } from "@langwatch/secret-contract";
import type { SecretEncryptionPort } from "@langwatch/secret-server";
import type { TraceService } from "@langwatch/trace-contract";
import type { WorkflowService } from "@langwatch/workflow-contract";
import type { UserService } from "@langwatch/user-contract";
import superjson from "superjson";
import { describe, expect, it, vi } from "vitest";
import { ApiApplication, MissingAgentService, MissingSecretService } from "../../api.application";
import { createSseSubscriptionApp } from "../../app-trpc/app-trpc.sse";
import { ApiRestSecurity } from "../../api-rest.security";
import { ApiRestObservabilityComposition } from "../api-rest-observability.composition";
import {
  ApiTrpcFeaturesComposition,
  composeApiTrpcCollaborators,
} from "../api-trpc-features.composition";
import { composeApiAgentGroupCollaborators } from "../api-trpc-collaborators.agent-group.composition";
import { stub, testHalves } from "./api-trpc-collaborators.test-halves";

const SESSION_USER = {
  id: "user-1",
  name: "Sam Rivers",
  email: "operator@acme.test",
  role: "ADMIN",
};
const PROJECT_ID = "project-1";
const ORGANIZATION_ID = "organization-1";
const CONVERSATION_ID = "conversation-1";
const SCENARIO_RUN_ID = "scenariorun-1";
const TURN_ID = "turn-1";

const noop = () => undefined;

/**
 * The rows this half actually reads, as a double.
 *
 * Every model here is one a REAL composed adapter reaches: the scenario table
 * the moved Prisma adapter lists, the suite table the packaged suite repository
 * lists, and the Langy conversation projection the packaged conversation
 * repository pages through.
 */
function testPrisma() {
  const client = {
    scenario: {
      findMany: vi.fn(async () => []),
      count: vi.fn(async () => 0),
      // The read PREPARING a run makes, scoped to the project. Empty is a real
      // answer — this project defines no scenario with that id — and it is the
      // first thing the prefetcher validates.
      findFirst: vi.fn(async () => null),
    },
    simulationSuite: {
      findMany: vi.fn(async () => []),
      findFirst: vi.fn(async () => null),
    },
    langyConversationProjection: {
      findMany: vi.fn(async () => []),
      findFirst: vi.fn(async () => ({
        Id: CONVERSATION_ID,
        ProjectId: PROJECT_ID,
        UserId: SESSION_USER.id,
      })),
      findUnique: vi.fn(async () => null),
    },
    langyMessageProjection: { findMany: vi.fn(async () => []) },
    project: { findFirst: vi.fn(async () => null), findUnique: vi.fn(async () => null) },
    // The operator's scheduled-job read is a cross-tenant `$queryRaw` scan, so
    // it reaches the client rather than a model delegate. An empty result is a
    // real answer for a deployment that has scheduled nothing.
    $queryRaw: vi.fn(async () => []),
  } as unknown as PrismaClient;

  const held = client as unknown as {
    scenario: { findMany: ReturnType<typeof vi.fn> };
    simulationSuite: { findMany: ReturnType<typeof vi.fn> };
    langyConversationProjection: { findMany: ReturnType<typeof vi.fn> };
  };
  return {
    client,
    scenario: held.scenario,
    simulationSuite: held.simulationSuite,
    langyConversationProjection: held.langyConversationProjection,
  };
}

/** Permits everything: the refusal path is the declared check's own suite. */
function testAuthz(): AuthzService {
  return {
    hasPermission: vi.fn(async () => true),
    getDecision: async (_input: AuthzGetDecisionInput): Promise<PermissionDecision> => ({
      permitted: true,
      organizationRole: null,
    }),
    getProjectAnyDecision: async (): Promise<PermissionDecision> => ({
      permitted: true,
      organizationRole: null,
    }),
    checkScopeLineage: async (): Promise<AuthzScopeLineageResult> => ({ kind: "consistent" }),
    tryResolveScope: async (input: { projectId?: string; organizationId?: string }) =>
      input.projectId
        ? { type: "project", id: input.projectId }
        : input.organizationId
          ? { type: "organization", id: input.organizationId }
          : null,
    effectivePermissions: async () => ["scenarios:view", "langy:view"],
  } as unknown as AuthzService;
}

/**
 * One emitter per tenant, held so a test can push an event onto exactly the
 * object a subscription is listening to.
 */
function testBroadcast() {
  const emitters = new Map<string, NodeEventEmitter>();
  const emitterFor = (tenantId: string) => {
    const existing = emitters.get(tenantId);
    if (existing) return existing;
    const created = new NodeEventEmitter();
    emitters.set(tenantId, created);
    return created;
  };
  const broadcast = {
    getTenantEmitter: (tenantId: string) => emitterFor(tenantId),
    cleanupTenantEmitter: noop,
  } as unknown as PresenceEmitterPort;
  return { broadcast, emitterFor };
}

/** The rollout the Langy gate reads, answerable either way per test. */
function testFeatureFlags(enabled: boolean): FeatureFlagService {
  return { isEnabled: vi.fn(async () => enabled) } as unknown as FeatureFlagService;
}

/**
 * This process's Eventing, as the API composes it — PRODUCER-only, over a fake
 * event store instead of `EventStoreProducerOnly`.
 *
 * The store is the one substitution, and it is what makes an enqueued command
 * observable in-process: the real API appends nothing, because the worker that
 * drains the queue does. Everything else is the production shape, including
 * `processManagerMode`, which is the whole reason the two pipelines that mount
 * a process manager can be registered here at all.
 */
function producerEventing() {
  const eventStore = EventStoreMemory.createForTesting();
  const eventSourcing = new EventSourcing({
    eventStore,
    executionTarget: "api",
    processManagerMode: "producer-only",
  });
  const storedEvents = async (input: {
    aggregateId: string;
    aggregateType: "simulation_run" | "langy_conversation";
  }) =>
    eventStore.getEvents(
      input.aggregateId,
      { tenantId: createTenantId(PROJECT_ID) },
      input.aggregateType,
    );
  return { eventSourcing, storedEvents };
}

/**
 * The install's shared ClickHouse endpoint, as the event-log explorer reaches
 * it: one `query` call, and the SQL it was handed recorded so the test can say
 * which table the composed repository read.
 */
type FakeEventLogClient = {
  asked: string[];
  query: (params: { query: string }) => Promise<{ json(): Promise<unknown> }>;
};

function eventLogClient(rows: unknown[]): FakeEventLogClient {
  const asked: string[] = [];
  return {
    asked,
    query: async ({ query }) => {
      asked.push(query);
      return { json: async () => rows };
    },
  };
}

function composeApplication(
  options: {
    langyEnabled?: boolean;
    adminEmails?: readonly string[];
    eventing?: EventSourcing;
    eventLogClient?: FakeEventLogClient;
  } = {},
) {
  const prisma = testPrisma();
  const authz = testAuthz();
  const { broadcast, emitterFor } = testBroadcast();

  const projects = {
    getOrganizationId: vi.fn(async () => ORGANIZATION_ID),
    tryGetWithTeam: vi.fn(async () => null),
    // Preparing a run reads the project's own ingestion key, which is what a
    // prepared child reports its scenario events with.
    tryGetById: vi.fn(async () => ({ id: PROJECT_ID, apiKey: "project-api-key" })),
  } as unknown as ProjectService;

  const group = composeApiAgentGroupCollaborators({
    prisma: prisma.client,
    authz,
    // The agent directory a suite's cases and an HTTP target resolve through.
    // `getById` answers the feature's own not-found rather than the stub's
    // refusal, because preparing a run against a target that is not there is a
    // real answer the drawer renders.
    agents: stub<AgentService>("agents", {
      getById: async ({ projectId, id }: { projectId: string; id: string }) => {
        throw new AgentNotFoundError(id, projectId);
      },
    }),
    auth: stub<AuthService>("auth"),
    users: stub<UserService>("users"),
    projects,
    organizations: stub<OrganizationService>("organizations"),
    featureFlags: testFeatureFlags(options.langyEnabled ?? true),
    broadcast,
    encryption: {
      encrypt: (plaintext: string) => `enc:${plaintext}`,
      decrypt: (ciphertext: string) => ciphertext.replace(/^enc:/, ""),
    } as unknown as SecretEncryptionPort,
    // No ClickHouse and no Redis, which is a real deployment shape: the run
    // reader answers the empty set and the live turn buffer is absent.
    resolveClickHouseClient: null,
    // The operator's event log is the one read here that is nobody's tenant,
    // so it takes the install's shared endpoint rather than the resolver
    // above. Absent by default: the explorer then refuses by name.
    eventLogClient: (options.eventLogClient ?? null) as never,
    redis: null,
    // The four verticals a scenario RUN is prepared against, and the three
    // deployment facts its child is booted with. Doubles at the PORTS: what
    // this half composes over them — the prefetcher, its lookups and the
    // failure handler — is real.
    scenarioExecution: {
      workflows: stub<WorkflowService>("workflows"),
      modelProviders: stub<ModelProviderService>("modelProviders"),
      secrets: stub<SecretService>("secrets"),
      traces: stub<TraceService>("traces"),
      config: {
        langwatchEndpoint: "https://ingest.acme.test",
        nlpServiceUrl: "http://nlp.acme.test:5561",
        legacyDefaultModel: "openai/gpt-5-mini",
      },
    },
    // Absent by default, which is a real deployment shape: with no queue every
    // agent-side write refuses by name. The suite below composes one where the
    // enqueued command is the thing under test.
    eventing: options.eventing,
    defaultRetentionDays: 49,
    demoProjectId: "demo-project",
    adminEmails: options.adminEmails ?? [SESSION_USER.email],
    audit: undefined,
    rateLimit: async () => ({ allowed: true, resetAt: Date.now() + 60_000 }),
    processName: "langwatch-api-test",
  });

  const features = ApiTrpcFeaturesComposition.tryCompose({
    database: { client: prisma.client } as unknown as PrismaConnection,
    authz,
    audit: undefined,
    collaborators: composeApiTrpcCollaborators(testHalves({ agentGroup: group })),
  });
  if (!features) throw new Error("the record refused to compose against its collaborators");

  const application = ApiApplication.create({
    agents: new MissingAgentService(),
    secrets: new MissingSecretService(),
    features,
    http: {
      createContext: async () => ({
        actor: () => ({ id: SESSION_USER.id }),
        tryActor: () => ({ id: SESSION_USER.id }),
        authorize: async () => undefined,
        session: { user: SESSION_USER },
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

  return { application, prisma, group, emitterFor };
}

/** The REST security the subscription lane declares its access against. */
function subscriptionSecurity() {
  return ApiRestSecurity.create({
    apiKeys: stub("apiKeys"),
    authz: stub("authz"),
    organizations: stub("organizations"),
    observability: ApiRestObservabilityComposition.create(),
  } as never);
}

async function callTrpc(
  application: ApiApplication,
  path: string,
  input: Record<string, unknown>,
  method: "query" | "mutation" = "query",
): Promise<{ status: number; body: unknown }> {
  if (!application.hono) throw new Error("HTTP composition was not created.");
  const url = `http://127.0.0.1/api/trpc/${path}`;
  const response =
    method === "mutation"
      ? await application.hono.request(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ json: input }),
        })
      : await application.hono.request(
          `${url}?input=${encodeURIComponent(JSON.stringify({ json: input }))}`,
        );
  return { status: response.status, body: await response.json() };
}

/**
 * Drives one subscription: opens the stream, waits for the procedure's own
 * listener to attach where there is one, emits an event, and reads the frames
 * back.
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
  emitter?: EventEmitter;
  channel?: string;
  event?: unknown;
  frames: number;
}) {
  const { application, path, input, emitter, channel, event, frames: wanted } = options;
  if (!application.hono) throw new Error("HTTP composition was not created.");

  const controller = new AbortController();
  const encoded = encodeURIComponent(superjson.stringify(input));
  const response = await application.hono.request(
    `http://127.0.0.1/api/sse/${path}?input=${encoded}`,
    { signal: controller.signal },
  );

  if (emitter && channel) {
    await vi.waitFor(() => {
      if (emitter.listenerCount(channel) === 0) throw new Error("no listener yet");
    });
    emitter.emit(channel, event);
  }

  const reader = response.body?.getReader();
  if (!reader) throw new Error("the subscription answered no stream");
  const decoder = new TextDecoder();
  const frames: unknown[] = [];
  let buffered = "";
  try {
    while (frames.length < wanted) {
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

describe("given the API process composed the agent-group half from its own graph", () => {
  describe("when the record is built", () => {
    it("mounts all six of this half's namespaces and no others of its own", () => {
      const { application } = composeApplication();
      const mounted = Object.keys(
        (application as unknown as { trpc: { _def: { procedures: Record<string, unknown> } } }).trpc
          ._def.procedures,
      ).map((path) => path.split(".")[0]);

      for (const namespace of [
        "scenarios",
        "suites",
        "langy",
        "langyEgress",
        "ops",
        "setupSkills",
      ]) {
        expect(mounted).toContain(namespace);
      }
    });
  });

  describe("when each namespace is called through the real /api/trpc handler", () => {
    it("lists a project's test cases off the composed Prisma adapter, scoped and unarchived", async () => {
      const { application, prisma } = composeApplication();

      const { status, body } = await callTrpc(application, "scenarios.getAll", {
        projectId: PROJECT_ID,
      });

      expect(status).toBe(200);
      expect(body).toMatchObject({ result: { data: { json: [] } } });
      // The discriminator: an archived case is never offered, and the read is
      // narrowed to the project the caller was authorized against.
      expect(prisma.scenario.findMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ projectId: PROJECT_ID, archivedAt: null }),
        }),
      );
    });

    it("lists a project's suites off the same connection", async () => {
      const { application, prisma } = composeApplication();

      const { status } = await callTrpc(application, "suites.getAll", { projectId: PROJECT_ID });

      expect(status).toBe(200);
      expect(prisma.simulationSuite.findMany).toHaveBeenCalled();
    });

    it("pages a caller's Langy conversations off the composed conversation projection", async () => {
      const { application, prisma } = composeApplication();

      const { status, body } = await callTrpc(application, "langy.list", {
        projectId: PROJECT_ID,
        limit: 30,
      });

      expect(status).toBe(200);
      expect(body).toMatchObject({ result: { data: { json: { items: [] } } } });
      expect(prisma.langyConversationProjection.findMany).toHaveBeenCalled();
    });

    it("reads the project's egress allow-list through both Langy gates", async () => {
      const { application } = composeApplication();

      const { status } = await callTrpc(application, "langyEgress.get", {
        projectId: PROJECT_ID,
      });

      expect(status).toBe(200);
    });

    it("resolves the operator scope from this process's own allow-list", async () => {
      const { application } = composeApplication();

      const { status, body } = await callTrpc(application, "ops.getScope", {});

      expect(status).toBe(200);
      expect(body).toMatchObject({ result: { data: { json: { scope: { kind: "platform" } } } } });
    });

    it("serves a setup skill's body from the catalogue that moved with the feature", async () => {
      const { application } = composeApplication();

      const { status, body } = await callTrpc(application, "setupSkills.getPrompt", {
        projectId: PROJECT_ID,
        skill: "tracing",
      });

      expect(status).toBe(200);
      const held = body as { result: { data: { json: { body: string } } } };
      expect(held.result.data.json.body.length).toBeGreaterThan(1_000);
    });
  });

  describe("when the three live channels are watched over /api/sse", () => {
    it("streams a simulation update on the same root the tRPC endpoint serves", async () => {
      const { application, emitterFor } = composeApplication();

      const watched = await watchSse({
        application,
        path: "scenarios.onSimulationUpdate",
        input: { projectId: PROJECT_ID },
        emitter: emitterFor(PROJECT_ID) as unknown as EventEmitter,
        channel: "simulation_updated",
        event: { event: JSON.stringify({ type: "run_started" }), timestamp: 1 },
        frames: 2,
      });

      expect(watched.status).toBe(200);
      expect(watched.contentType).toBe("text/event-stream; charset=utf-8");
      expect(watched.frames[0]).toEqual({ type: "connected" });
      expect(watched.frames[1]).toMatchObject({ timestamp: 1 });
    });

    it("streams a Langy conversation update the same way, narrowed to the caller", async () => {
      const { application, emitterFor } = composeApplication();

      const watched = await watchSse({
        application,
        path: "langy.onConversationUpdate",
        input: { projectId: PROJECT_ID },
        emitter: emitterFor(PROJECT_ID) as unknown as EventEmitter,
        channel: "langy_conversation_updated",
        event: {
          // The payload the tenant broadcast carries, in the shape the
          // user-scope gate reads: the fan-out is tenant-wide, so a signal for
          // a conversation this caller does not own is dropped rather than
          // delivered. `ownerUserId` is what makes this one theirs.
          event: JSON.stringify({ ownerUserId: SESSION_USER.id, isShared: false }),
          timestamp: 2,
        },
        frames: 2,
      });

      expect(watched.status).toBe(200);
      expect(watched.frames[0]).toEqual({ type: "connected" });
      expect(watched.frames[1]).toMatchObject({ timestamp: 2 });
    });

    it("opens the turn stream, passes its watch gate, and completes with no live buffer", async () => {
      const { application } = composeApplication();

      // The whole point of driving this one on a Redis-less process: the gate is
      // the part that must work — a caller who cannot see the conversation is
      // refused — and the transport's own documented answer to "no Redis" is to
      // yield nothing so the browser falls back to the Postgres read. A stream
      // that completes cleanly is that answer; a stream that errored would mean
      // the gate or the mount was wrong.
      const watched = await watchSse({
        application,
        path: "langy.onTurnStream",
        input: { projectId: PROJECT_ID, conversationId: CONVERSATION_ID, turnId: TURN_ID },
        frames: 2,
      });

      expect(watched.status).toBe(200);
      expect(watched.frames[0]).toEqual({ type: "connected" });
      expect(watched.frames[1]).toEqual({ type: "complete" });
    });
  });

  describe("when the agent-side pipelines are registered producer-only", () => {
    /**
     * The write path end to end: the real `/api/trpc` handler, this process's
     * policy chain, the composed scenario application, the packaged
     * `simulation_processing` definition registered PRODUCER-only, and the
     * command's own handler appending onto the event store.
     *
     * `cancelJob` rather than `run`: both dispatch on the same registration,
     * and `run` first has to resolve its target through a prefetcher this
     * process does not compose — which is a DEPLOYMENT absence and has its own
     * assertion below.
     */
    it("lands a scenario run command on the event store through the real handler", async () => {
      const { eventSourcing, storedEvents } = producerEventing();
      const { application } = composeApplication({ eventing: eventSourcing });

      const { status, body } = await callTrpc(
        application,
        "scenarios.cancelJob",
        {
          projectId: PROJECT_ID,
          scenarioSetId: "set-1",
          batchRunId: "batch-1",
          scenarioRunId: SCENARIO_RUN_ID,
          scenarioId: "scenario-1",
        },
        "mutation",
      );

      expect(status).toBe(200);
      expect(body).toMatchObject({ result: { data: { json: { cancelled: true } } } });
      const appended = await storedEvents({
        aggregateId: SCENARIO_RUN_ID,
        aggregateType: "simulation_run",
      });
      expect(appended.map((event) => event.type)).toEqual(["lw.simulation_run.cancel_requested"]);
      await eventSourcing.close();
    });

    /**
     * The same proof on the other pipeline, whose sixteen commands were refused
     * for the same one reason.
     *
     * Archiving rather than starting a turn, for the reason the refusal below
     * states: a turn dispatches to an agent manager this process composes none
     * of, which is a deployment absence rather than the framework one this
     * suite is about. Both writes come off the SAME registration.
     */
    it("lands a Langy conversation command on the event store through the real handler", async () => {
      const { eventSourcing, storedEvents } = producerEventing();
      const { application } = composeApplication({ eventing: eventSourcing });

      const { status, body } = await callTrpc(
        application,
        "langy.deleteConversation",
        { projectId: PROJECT_ID, conversationId: CONVERSATION_ID },
        "mutation",
      );

      expect(status).toBe(200);
      expect(body).toMatchObject({ result: { data: { json: { success: true } } } });
      const appended = await storedEvents({
        aggregateId: CONVERSATION_ID,
        aggregateType: "langy_conversation",
      });
      expect(appended.map((event) => event.type)).toEqual([
        "lw.langy_conversation.conversation_archived",
      ]);
      await eventSourcing.close();
    });

    /**
     * The discriminator between "registered" and "registered and half-running".
     *
     * Both definitions mount a process manager, and this process runs neither:
     * their inbox, outbox and wakes are the worker's. The runtime names them
     * rather than counting them, so a deployment reads WHICH manager is not
     * running here.
     */
    it("declines the process managers by name rather than running them", async () => {
      const { eventSourcing } = producerEventing();
      composeApplication({ eventing: eventSourcing });

      expect(eventSourcing.unrunProcessManagers).toEqual(
        expect.arrayContaining(["simulation_run_execution"]),
      );
      expect(() => eventSourcing.processRuntime).toThrow(/producer-only/);
      await eventSourcing.close();
    });
  });

  describe("when a scenario run is prepared against this process's own graph", () => {
    it("validates the run through the composed prefetcher rather than refusing by name", async () => {
      const { group, prisma } = composeApplication();

      // Driven on the composed application rather than over HTTP, the way the
      // trace half's reads are: reaching this through `scenarios.run` would
      // first have to satisfy a parameter resolution that reads a scenario row
      // this test does not hold.
      const result = await group.scenarios.prefetchExecution({
        context: {
          projectId: PROJECT_ID,
          scenarioId: "scenario-1",
          setId: "set-1",
          batchRunId: "batch-1",
          parameters: {},
          secretParameters: {},
        },
        target: { type: "http", referenceId: "agent-1" },
      });

      // A STRUCTURED failure naming the missing scenario, which is what the run
      // drawer renders. Before the executor was composed the same call rejected
      // with `service_unavailable`, and the person was told the deployment
      // could not run scenarios at all.
      expect(result).toEqual({ success: false, error: "Scenario scenario-1 not found" });
      // And it got there by READING: the composed lookup service ran the real
      // scenario repository over this connection, scoped to the project.
      expect(prisma.scenario.findFirst).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ id: "scenario-1", projectId: PROJECT_ID }),
        }),
      );
    });
  });

  describe("when a capability this process did not compose is reached", () => {
    it("refuses to start a Langy turn with the feature's own agent-unavailable code", async () => {
      const { application } = composeApplication();

      const { status, body } = await callTrpc(
        application,
        "langy.createConversation",
        {
          projectId: PROJECT_ID,
          idempotencyKey: "idempotency-key-1",
          messages: [{ role: "user", parts: [{ type: "text", text: "hello" }] }],
          turnContext: {},
        },
        "mutation",
      );

      // Not this composition's `service_unavailable` but Langy's OWN
      // `langy_agent_unavailable`, and that is the better answer: a web process
      // composes no agent manager, the feature already has a typed refusal for
      // exactly that shape, and the client renders words for it. The composed
      // graph reaching the feature's refusal rather than a generic one is what
      // this pins.
      expect(status).toBeGreaterThanOrEqual(400);
      expect(JSON.stringify(body)).toContain("langy_agent_unavailable");
    });

    it("reads the scheduled-job store rather than refusing it by name", async () => {
      const { application } = composeApplication();

      const { status, body } = await callTrpc(application, "ops.listScheduledJobs", {
        limit: 20,
      });

      // Before the store was composed this refused with the operator-runtime
      // error. An empty list is the honest answer for a deployment that has
      // scheduled nothing; a refusal was not.
      expect(status).toBe(200);
      expect(JSON.stringify(body)).not.toContain("scheduled-job store");
    });

    /** @scenario "The operator searches the event log through the composed explorer" */
    it("searches the event log rather than refusing it by name", async () => {
      const client = eventLogClient([
        {
          aggregateId: "conversation-42",
          aggregateType: "langy-conversation",
          tenantId: PROJECT_ID,
          eventCount: "7",
          lastEventTime: "1756800000000",
        },
      ]);
      const { application } = composeApplication({ eventLogClient: client });

      const { status, body } = await callTrpc(application, "ops.searchAggregates", {
        query: "conversation-42",
      });

      expect(status).toBe(200);
      // The composed repository's own read, on the shared endpoint: before it
      // was composed, every method of the explorer refused by name.
      expect(client.asked).toHaveLength(1);
      expect(client.asked[0]).toContain("FROM event_log");
      expect(JSON.stringify(body)).toContain("conversation-42");
      expect(JSON.stringify(body)).not.toContain("the event-log explorer");
    });

    /** @scenario "An install with no shared endpoint refuses the search by name" */
    it("names the event-log explorer when this deployment has no shared endpoint", async () => {
      const { application } = composeApplication();

      const { status, body } = await callTrpc(application, "ops.searchAggregates", {
        query: "conversation-42",
      });

      // A deployment holding only private routes has no install-wide event log
      // to search, and refusing beats answering the empty set, which would read
      // as "this install has recorded nothing". The capability NAME reaches the
      // log rather than the wire — tRPC replaces a handled message with its
      // code slug — so what is observable here is the refusal itself.
      expect(status).toBeGreaterThanOrEqual(400);
      expect(JSON.stringify(body)).toContain("service_unavailable");
    });

    it("keeps a caller who is not on the allow-list out of the operator surface", async () => {
      const { application } = composeApplication({ adminEmails: ["someone-else@acme.test"] });

      const { body } = await callTrpc(application, "ops.getScope", {});

      // The PROBE variant: it reports "no access" rather than refusing, which is
      // what lets the global menu poll it on every page load.
      expect(body).toMatchObject({ result: { data: { json: { scope: { kind: "none" } } } } });
    });

    it("keeps a project outside the Langy rollout dark rather than empty", async () => {
      const { application } = composeApplication({ langyEnabled: false });

      const { status, body } = await callTrpc(application, "langy.list", {
        projectId: PROJECT_ID,
        limit: 30,
      });

      expect(status).toBeGreaterThanOrEqual(400);
      expect(JSON.stringify(body)).toContain("langy_not_enabled");
    });
  });
});
