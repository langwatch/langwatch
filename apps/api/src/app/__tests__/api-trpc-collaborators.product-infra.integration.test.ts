/**
 * The product-infrastructure half of the packaged tRPC record, served by the
 * API process.
 *
 * What this pins is one call per namespace this half mounts, each of them made
 * over the REAL `/api/trpc` handler on THIS process's root, through THIS
 * process's policy chain, against the collaborator set
 * `composeApiProductInfraCollaborators` produced. Nothing here reaches a stub
 * through a proxy: the fakes are at the PORTS — a Prisma double, an AuthZ
 * service, a ClickHouse client and a real directory on disk — and everything
 * between the HTTP request and them is the composed graph.
 *
 *   storedObjects.headById       the MOVED store, end to end: the ClickHouse
 *                                repository's row read, the storage registry's
 *                                scheme dispatch, and the local-filesystem
 *                                driver's existence probe against real bytes.
 *                                All three of its answers are driven, because
 *                                the whole point of the probe is telling
 *                                "the file is gone" apart from "that id never
 *                                existed".
 *   dataRetention.getRules       the MOVED snapshot, with the RBAC filter
 *                                observable rather than assumed: a team the
 *                                caller cannot manage is neither offered as a
 *                                writable scope nor allowed to name its own
 *                                rule.
 *   dataRetention.getScopeStorageUsage
 *                                the MOVED scope meter, narrowed to the
 *                                projects the caller may read — a wider scope
 *                                never surfaces storage they could not
 *                                otherwise see.
 *   monitors.getAllForProject    the SAME monitor service the execution half's
 *                                experiment application upserts through,
 *                                answering off this process's own connection.
 *
 * And two named absences, because an absence nobody can observe is
 * indistinguishable from a stub: with no evaluation-run read stack the
 * seven-day performance trend refuses by name rather than reporting that no
 * monitor caught anything, and with no plan provider a retention write refuses
 * rather than passing a gate it could not evaluate.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AuthzService } from "@langwatch/authz-contract";
import type { DataRetentionService } from "@langwatch/data-retention-contract";
import type { EvaluatorService } from "@langwatch/evaluator-contract";
import { PostgresMonitorAdapter } from "@langwatch/monitor-server";
import type { PrismaConnection } from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { ApiApplication } from "../../api.application";
import type { AnyApiTrpcCollaborators } from "../../app-trpc/app-trpc.collaborators";
import type { ApiTrpcFeatureApplication } from "../../app-trpc/app-trpc.context";
import type { ApiStoredObjectsConfigResolution } from "../../platform/config/api.config";
import { ApiTrpcFeaturesComposition } from "../api-trpc-features.composition";
import {
  composeApiProductInfraCollaborators,
  withApiProductInfraCollaborators,
} from "../api-trpc-collaborators.product-infra.composition";

/**
 * A collaborator group with only the members the record reads while it is
 * being BUILT. Everything else answers a function that refuses by name when a
 * call actually reaches it.
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

const anySchema = z.any();
const openGate = <TProcedure>(procedure: TProcedure): TProcedure => procedure;
const passThroughMiddleware = ({ next }: { next: () => unknown }) => next();

const SESSION_USER = { id: "user-1", name: "Sam Rivers", email: "sam@acme.test", role: "ADMIN" };
const PROJECT_ID = "project-1";
const OTHER_PROJECT_ID = "project-2";
const TEAM_ID = "team-1";
const OTHER_TEAM_ID = "team-2";
const ORGANIZATION_ID = "organization-1";
const OBJECT_ID = "so_present";
const MISSING_OBJECT_ID = "so_bytes_gone";
const AZURE_OBJECT_ID = "so_on_azure";
const AZURE_ACCOUNT = "lwacct";
const AZURE_CONTAINER = "stored-objects";
const AZURE_ENDPOINT = "https://lwacct.blob.core.windows.test";
const AZURE_OBJECT_URI = `azure-blob://${AZURE_ACCOUNT}/${AZURE_CONTAINER}/${PROJECT_ID}/abc123`;

/** A directory holding one object's real bytes, and one address with none. */
function testObjectStorage() {
  const root = mkdtempSync(join(tmpdir(), "langwatch-stored-objects-"));
  const presentPath = join(root, "present.bin");
  writeFileSync(presentPath, Buffer.from("hello"));
  return {
    root,
    presentUri: `file://${presentPath}`,
    absentUri: `file://${join(root, "never-written.bin")}`,
  };
}

/** The rows this half actually reads, as a double. */
function testPrisma() {
  const client = {
    project: {
      findUnique: vi.fn(async ({ where }: { where: { id: string } }) => ({
        id: where.id,
        name: where.id === PROJECT_ID ? "Acme" : "Other",
        teamId: where.id === PROJECT_ID ? TEAM_ID : OTHER_TEAM_ID,
        team: {
          organizationId: ORGANIZATION_ID,
          organization: { name: "Acme Inc" },
        },
      })),
      findMany: vi.fn(async () => [
        {
          id: PROJECT_ID,
          name: "Acme",
          teamId: TEAM_ID,
          archivedAt: null,
        },
        {
          id: OTHER_PROJECT_ID,
          name: "Other",
          teamId: OTHER_TEAM_ID,
          archivedAt: null,
        },
      ]),
    },
    team: {
      findMany: vi.fn(async () => [
        { id: TEAM_ID, name: "Platform" },
        { id: OTHER_TEAM_ID, name: "Finance" },
      ]),
      findUnique: vi.fn(async () => ({ organizationId: ORGANIZATION_ID })),
    },
    organization: { findUnique: vi.fn(async () => ({ id: ORGANIZATION_ID })) },
    monitor: {
      findMany: vi.fn(async () => [
        {
          id: "monitor-1",
          projectId: PROJECT_ID,
          experimentId: null,
          evaluatorId: null,
          checkType: "langevals/basic",
          name: "Toxicity",
          slug: "toxicity",
          executionMode: "ON_MESSAGE",
          enabled: true,
          preconditions: [],
          parameters: {},
          mappings: null,
          sample: 1,
          level: "trace",
          threadIdleTimeout: null,
          createdAt: new Date("2026-09-01T00:00:00.000Z"),
          updatedAt: new Date("2026-09-01T00:00:00.000Z"),
          evaluator: null,
        },
      ]),
    },
  } as unknown as PrismaClient;
  return { client };
}

/**
 * The AuthZ service every declared check and every scope filter runs on.
 *
 * The caller manages `team-1` and may update `project-1`, and neither for the
 * second team's project. That asymmetry is the whole point: it is what makes
 * the RBAC filter observable rather than asserted.
 */
function testAuthz(): AuthzService {
  return {
    // The DECLARED check on each procedure permits: the refusal path is that
    // check's own suite, and what this file is about is the RBAC filtering the
    // resolvers do underneath it.
    getDecision: async () => ({ permitted: true, organizationRole: null }),
    getProjectAnyDecision: async () => ({ permitted: true, organizationRole: null }),
    hasPermission: async ({ permission, projectId }: { permission: string; projectId?: string }) =>
      projectId === PROJECT_ID && permission !== "organization:manage",
    checkScopeLineage: async () => ({ kind: "consistent" }),
    canBatchByIds: async ({
      permission,
      teams,
      projects,
    }: {
      permission: string;
      teams: readonly { teamId: string }[];
      projects: readonly { projectId: string }[];
    }) => ({
      teams: new Map(
        teams.map(({ teamId }) => [teamId, permission === "team:manage" && teamId === TEAM_ID]),
      ),
      projects: new Map(
        projects.map(({ projectId }) => [projectId, projectId === PROJECT_ID]),
      ),
    }),
    tryResolveScope: async (input: { projectId?: string; organizationId?: string }) =>
      input.projectId
        ? { type: "project", id: input.projectId }
        : input.organizationId
          ? { type: "organization", id: input.organizationId }
          : null,
    effectivePermissions: async () => ["project:view", "traces:view"],
  } as unknown as AuthzService;
}

/** The routed ClickHouse connection the object repository reads through. */
function testClickHouse(storage: ReturnType<typeof testObjectStorage>) {
  const rows = new Map<string, Record<string, unknown>>([
    [
      OBJECT_ID,
      {
        id: OBJECT_ID,
        project_id: PROJECT_ID,
        purpose: "trace_content",
        owner_kind: "span",
        owner_id: "span-1",
        media_type: "image/png",
        size_bytes: 5,
        sha256: "deadbeef",
        storage_uri: storage.presentUri,
        created_at: "2026-09-01T00:00:00.000Z",
        inserted_at: "2026-09-01T00:00:00.000Z",
      },
    ],
    [
      AZURE_OBJECT_ID,
      {
        id: AZURE_OBJECT_ID,
        project_id: PROJECT_ID,
        purpose: "trace_content",
        owner_kind: "span",
        owner_id: "span-3",
        media_type: "image/jpeg",
        size_bytes: 12,
        sha256: "0badcafe",
        storage_uri: AZURE_OBJECT_URI,
        created_at: "2026-09-01T00:00:00.000Z",
        inserted_at: "2026-09-01T00:00:00.000Z",
      },
    ],
    [
      MISSING_OBJECT_ID,
      {
        id: MISSING_OBJECT_ID,
        project_id: PROJECT_ID,
        purpose: "trace_content",
        owner_kind: "span",
        owner_id: "span-2",
        media_type: "audio/wav",
        size_bytes: 9,
        sha256: "cafebabe",
        storage_uri: storage.absentUri,
        created_at: "2026-09-01T00:00:00.000Z",
        inserted_at: "2026-09-01T00:00:00.000Z",
      },
    ],
  ]);
  const resolveClient = vi.fn(async () => ({
    query: async ({ query_params }: { query_params: Record<string, unknown> }) => {
      const row = rows.get(String(query_params.id));
      return { json: async () => (row ? [row] : []) };
    },
    insert: async () => undefined,
    exec: async () => undefined,
  }));
  return { resolveClient: resolveClient as unknown as (projectId: string) => Promise<unknown> };
}

/** The retention service the settings page reads through. */
function testDataRetention(): DataRetentionService {
  return {
    getResolvedForProject: vi.fn(async () => ({ traces: 49 })),
    listOrganizationRules: vi.fn(async () => [
      { scopeType: "PROJECT", scopeId: PROJECT_ID, category: "traces", retentionDays: 63 },
      // The caller cannot manage the second team, so this rule must not be
      // listed: naming it would leak another team's retention window.
      { scopeType: "TEAM", scopeId: OTHER_TEAM_ID, category: "traces", retentionDays: 3_500 },
    ]),
    getTotalStorageBytes: vi.fn(async () => 1),
    getTotalStorageBytesForTenants: vi.fn(
      async ({ tenantIds }: { tenantIds: readonly string[] }) => tenantIds.length * 1_000,
    ),
  } as unknown as DataRetentionService;
}

/**
 * The rest of the record, stubbed: this file describes the
 * product-infrastructure half, and a namespace it does not own answering a
 * call would mean the test had wandered.
 */
function baseCollaborators(): AnyApiTrpcCollaborators {
  return {
    application: stub<ApiTrpcFeatureApplication>("app"),
    analytics: {
      reads: stub("analytics.reads", {
        timeseriesInputSchema: anySchema,
        sharedFiltersSchema: anySchema,
        filterFieldSchema: anySchema,
      }),
      workbench: stub("analytics.workbench", {
        requireWorkbenchEnabled: openGate,
        maxStatementLength: 4_000,
        timeWindowSchema: anySchema,
        granularityStepSchema: anySchema,
      }),
      savedCharts: stub("analytics.savedCharts", {
        requireWorkbenchEnabled: openGate,
        timeWindowSchema: anySchema,
        granularityStepSchema: anySchema,
      }),
    },
    annotation: stub("annotation"),
    auth: stub("auth"),
    batchRecord: stub("batchRecord"),
    bugReports: stub("bugReports"),
    dataPrivacy: stub("dataPrivacy"),
    dataset: stub("dataset"),
    evaluators: stub("evaluators"),
    evaluations: stub("evaluations", { mappingsSchema: anySchema }),
    experiments: stub("experiments", { workbenchStateSchema: anySchema }),
    graphs: stub("graphs", { filterFieldSchema: anySchema }),
    group: stub("group"),
    home: stub("home"),
    identity: stub("identity"),
    integrationsChecks: stub("integrationsChecks"),
    joinRequests: stub("joinRequests"),
    onboarding: stub("onboarding", { signUpDataSchema: anySchema }),
    prompts: stub("prompts"),
    role: stub("role", { customRolePermission: anySchema }),
    team: stub("team"),
    productInfra: {
      dataRetention: stub("productInfra.dataRetention"),
      monitors: stub("productInfra.monitors", { preconditionsSchema: anySchema }),
    },
    /**
     * The nine tenant-administration surfaces, stubbed with only what the
     * record reads while it is BUILT: the sign-up questionnaire the
     * organization ceremony parses against, and the three data-dependent
     * gates the mounts chain onto a procedure. Its own suite is what proves it
     * answers.
     */
    orgGroup: {
      organization: stub("orgGroup.organization", {
        signUpDataSchema: anySchema,
        isCustomRole: () => false,
      }),
      organizationAuditLogCheck: passThroughMiddleware,
      project: stub("orgGroup.project"),
      projectChecks: {
        create: passThroughMiddleware,
        traceSharing: passThroughMiddleware,
      },
      codingAgents: stub("orgGroup.codingAgents"),
      automation: stub("orgGroup.automation", {
        providers: stub("orgGroup.automation.providers"),
      }),
      emailSuppression: stub("orgGroup.emailSuppression"),
      enterprise: {
        scimToken: stub("orgGroup.enterprise.scimToken"),
        ssoConnections: stub("orgGroup.enterprise.ssoConnections"),
        saasBilling: false,
      },
    },
    traceGroup: {
      traces: stub("traceGroup.traces", {
        listInputSchema: anySchema,
        filterInputSchema: anySchema,
        evaluatorTypeSchema: anySchema,
        preconditionSchema: anySchema,
      }),
      tracesV2: stub("traceGroup.tracesV2", { traceMetadataUpdateSchema: anySchema }),
      spans: stub("traceGroup.spans"),
      traceEditOverlay: stub("traceGroup.traceEditOverlay"),
      sharedTrace: stub("traceGroup.sharedTrace"),
      savedViews: stub("traceGroup.savedViews"),
      costs: stub("traceGroup.costs"),
      llmModelCost: stub("traceGroup.llmModelCost"),
      modelProvider: stub("traceGroup.modelProvider"),
      modelProviderChecks: {
        tenantWrite: () => passThroughMiddleware,
        credentialProbe: passThroughMiddleware,
      },
      translate: stub("traceGroup.translate"),
      httpProxy: stub("traceGroup.httpProxy"),
      limits: stub("traceGroup.limits"),
    },
    /**
     * The agent and organization groups, stubbed with only what the record
     * reads while it is BUILT. Their own suites are what prove they answer.
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
      langy: stub("agentGroup.langy"),
      langyGates: {
        refuseDemoProject: passThroughMiddleware,
        enforceLangyAccess: passThroughMiddleware,
      },
      langyEgress: stub("agentGroup.langyEgress"),
      ops: stub("agentGroup.ops"),
      opsCheck: () => passThroughMiddleware,
      scenarios: stub("agentGroup.scenarios"),
    },
    user: stub("user"),
    workflows: {
      lifecycle: stub("workflows.lifecycle"),
      optimization: stub("workflows.optimization"),
    },
  } as unknown as AnyApiTrpcCollaborators;
}

/** No S3 anywhere: this deployment addresses its bytes on its own disk. */
function testStorageConfig(): ApiStoredObjectsConfigResolution {
  return {
    backend: undefined,
    localFilesystemRoot: undefined,
    s3: {
      bucket: undefined,
      endpoint: undefined,
      region: undefined,
      accessKeyId: undefined,
      secretAccessKey: undefined,
      sessionToken: undefined,
    },
    // No Azure block either. The registry registers the Azure driver as a
    // FACTORY, so an unconfigured deployment never resolves these — which is
    // exactly what this stub proves by being empty and still composing.
    azure: emptyAzureConfig(),
    routes: new Map(),
  };
}

function emptyAzureConfig(): ApiStoredObjectsConfigResolution["azure"] {
  return {
    backend: undefined,
    authMode: undefined,
    accountName: undefined,
    accountKey: undefined,
    container: undefined,
    endpoint: undefined,
    authorityHost: undefined,
    tokenAudience: undefined,
    allowInsecureTokenEndpointForTests: false,
    identity: {},
  };
}

/** A deployment whose bytes live in an Azure Blob account, shared-key. */
function azureStorageConfig(): ApiStoredObjectsConfigResolution {
  return {
    backend: "azure",
    localFilesystemRoot: undefined,
    s3: {
      bucket: undefined,
      endpoint: undefined,
      region: undefined,
      accessKeyId: undefined,
      secretAccessKey: undefined,
      sessionToken: undefined,
    },
    azure: {
      ...emptyAzureConfig(),
      backend: "azure",
      authMode: "sharedKey",
      accountName: AZURE_ACCOUNT,
      accountKey: Buffer.from("an-account-key").toString("base64"),
      container: AZURE_CONTAINER,
      endpoint: AZURE_ENDPOINT,
    },
    routes: new Map(),
  };
}

/** The organization's plan, as every retention gate reads it. */
const PAID_PLAN = { free: false, type: "LAUNCH" } as never;

function composeHalf(
  options: { plans?: undefined; storage?: ApiStoredObjectsConfigResolution } = {},
) {
  const storage = testObjectStorage();
  const prisma = testPrisma();
  const authz = testAuthz();
  const clickHouse = testClickHouse(storage);
  const { storage: storageConfig, ...rest } = options;

  const half = composeApiProductInfraCollaborators({
    prisma: prisma.client,
    authz,
    dataRetention: testDataRetention(),
    // The REAL monitor service, over the same double: what this pins is that
    // `monitors.*` answers from the service the execution half composed rather
    // than from a second one built here.
    monitors: PostgresMonitorAdapter.create({
      database: prisma.client,
      evaluators: { archive: vi.fn(async () => undefined) } as unknown as EvaluatorService,
      generateId: () => "monitor-2",
    }),
    evaluators: { archive: vi.fn(async () => undefined) } as unknown as EvaluatorService,
    evaluatorReplication: {
      replicateEvaluatorWorkflow: vi.fn(async () => "workflow-copy"),
      deleteReplicatedWorkflow: vi.fn(async () => undefined),
    } as never,
    ops: { isAdmin: () => false } as never,
    resolveClickHouseClient: clickHouse.resolveClient,
    storage: storageConfig ?? testStorageConfig(),
    plans: { getActivePlan: async () => PAID_PLAN },
    ...rest,
  });

  return { half, storage, prisma, authz, clickHouse };
}

function composeApplication(
  options: { plans?: undefined; storage?: ApiStoredObjectsConfigResolution } = {},
) {
  const composed = composeHalf(options);

  const features = ApiTrpcFeaturesComposition.tryCompose({
    database: { client: composed.prisma.client } as unknown as PrismaConnection,
    authz: composed.authz,
    audit: undefined,
    collaborators: withApiProductInfraCollaborators(baseCollaborators(), composed.half),
  });
  if (!features) throw new Error("the record refused to compose against its collaborators");

  const application = ApiApplication.create({
    features,
    http: {
      createContext: async () => ({
        actor: () => ({ id: SESSION_USER.id }),
        tryActor: () => ({ id: SESSION_USER.id }),
        authorize: async () => undefined,
        session: { user: SESSION_USER },
      }),
    },
  });

  return { application, ...composed };
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

describe("given an API process composed with the product-infrastructure half", () => {
  describe("when the renderer probes a stored object it holds an id for", () => {
    it("reports the object available, having read the row and the bytes", async () => {
      const { application } = composeApplication();

      const { status, body } = await callTrpc(application, "storedObjects.headById", {
        projectId: PROJECT_ID,
        id: OBJECT_ID,
      });

      expect(status).toBe(200);
      expect(body).toMatchObject({
        result: { data: { json: { status: "available", mediaType: "image/png" } } },
      });
    });

    describe("and the row is there but the bytes are gone", () => {
      it("reports it missing rather than not found, which is what the placeholder renders", async () => {
        const { application } = composeApplication();

        const { body } = await callTrpc(application, "storedObjects.headById", {
          projectId: PROJECT_ID,
          id: MISSING_OBJECT_ID,
        });

        expect(body).toMatchObject({
          result: { data: { json: { status: "missing", mediaType: "audio/wav" } } },
        });
      });
    });

    describe("and this deployment keeps its bytes in Azure Blob", () => {
      /**
       * The registry registers the Azure driver as a FACTORY, so nothing is
       * constructed until an `azure-blob://` URI is actually read. What this
       * pins is that reading one reaches AZURE — the request goes to the
       * configured account endpoint under a shared-key signature — rather than
       * being refused by scheme or answered by the S3 driver, which would
       * report a file gone that is not.
       */
      it("probes the bytes through the Azure driver, at the configured account", async () => {
        const requests: Array<{ url: string; method: string; authorization: string }> = [];
        vi.stubGlobal(
          "fetch",
          vi.fn(async (url: string, init: { method: string; headers: Record<string, string> }) => {
            requests.push({
              url: String(url),
              method: init.method,
              authorization: init.headers.Authorization ?? "",
            });
            return new Response(null, { status: 200, headers: { "content-length": "12" } });
          }),
        );
        try {
          const { application } = composeApplication({ storage: azureStorageConfig() });

          const { status, body } = await callTrpc(application, "storedObjects.headById", {
            projectId: PROJECT_ID,
            id: AZURE_OBJECT_ID,
          });

          expect(status).toBe(200);
          expect(body).toMatchObject({
            result: { data: { json: { status: "available", mediaType: "image/jpeg" } } },
          });
          expect(requests).toHaveLength(1);
          expect(requests[0]?.url).toBe(
            `${AZURE_ENDPOINT}/${AZURE_CONTAINER}/${PROJECT_ID}/abc123`,
          );
          expect(requests[0]?.method).toBe("HEAD");
          expect(requests[0]?.authorization).toContain(`SharedKey ${AZURE_ACCOUNT}:`);
        } finally {
          vi.unstubAllGlobals();
        }
      });
    });

    describe("and the object is on Azure but this deployment configured no account", () => {
      /**
       * The credential resolver refuses BY NAME rather than the read reporting
       * the object gone. A deployment that lost its Azure configuration has
       * files it cannot reach, not files that were deleted, and the two answers
       * lead an operator to opposite actions.
       */
      it("refuses rather than reporting the file missing", async () => {
        const { application } = composeApplication();

        const { body } = await callTrpc(application, "storedObjects.headById", {
          projectId: PROJECT_ID,
          id: AZURE_OBJECT_ID,
        });

        expect(JSON.stringify(body)).not.toContain('"status":"missing"');
        expect(JSON.stringify(body)).toContain("error");
      });
    });

    describe("and no row answers to the id", () => {
      it("reports it not found, so the renderer shows an error rather than a placeholder", async () => {
        const { application } = composeApplication();

        const { body } = await callTrpc(application, "storedObjects.headById", {
          projectId: PROJECT_ID,
          id: "so_never_existed",
        });

        expect(body).toMatchObject({ result: { data: { json: { status: "not_found" } } } });
      });
    });
  });

  describe("when the retention settings page is opened", () => {
    it("offers only the scopes the caller may write, and lists no rule they may not read", async () => {
      const { application } = composeApplication();

      const { status, body } = await callTrpc(application, "dataRetention.getRules", {
        projectId: PROJECT_ID,
      });

      expect(status).toBe(200);
      const snapshot = (
        body as { result: { data: { json: Record<string, unknown> } } }
      ).result.data.json;

      // The caller manages one team and one project, and no organization.
      expect(snapshot.available).toEqual({
        organization: null,
        teams: [{ id: TEAM_ID, name: "Platform" }],
        projects: [{ id: PROJECT_ID, name: "Acme", teamId: TEAM_ID }],
      });
      // The second team's rule is withheld: reading it would hand a member the
      // retention window of a team they do not manage.
      expect(snapshot.rules).toEqual([
        {
          scopeType: "PROJECT",
          scopeId: PROJECT_ID,
          name: "Acme",
          category: "traces",
          retentionDays: 63,
        },
      ]);
    });
  });

  describe("when the storage card reads an organization-wide scope", () => {
    it("sums only the projects the caller may view", async () => {
      const { application } = composeApplication();

      const { status, body } = await callTrpc(
        application,
        "dataRetention.getScopeStorageUsage",
        {
          projectId: PROJECT_ID,
          scope: { scopeType: "ORGANIZATION", scopeId: ORGANIZATION_ID },
        },
      );

      expect(status).toBe(200);
      // Two projects are in the organization; one is readable, so the rollup
      // reports one rather than widening to what the scope contains.
      expect(body).toMatchObject({
        result: { data: { json: { totalBytes: 1_000, projectCount: 1 } } },
      });
    });
  });

  describe("when the monitors page lists a project's evaluations", () => {
    it("answers from the same monitor service the experiment application writes through", async () => {
      const { application, prisma } = composeApplication();

      const { status, body } = await callTrpc(application, "monitors.getAllForProject", {
        projectId: PROJECT_ID,
      });

      expect(status).toBe(200);
      expect(body).toMatchObject({
        result: { data: { json: [{ id: "monitor-1", name: "Toxicity" }] } },
      });
      expect(prisma.client.monitor.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { projectId: PROJECT_ID } }),
      );
    });
  });

  describe("when a capability this deployment did not compose is reached", () => {
    it("refuses the performance trend by name rather than reporting an empty one", async () => {
      const { application } = composeApplication();

      const { body } = await callTrpc(application, "monitors.getPerformanceForProject", {
        projectId: PROJECT_ID,
      });

      // The status the tRPC lane answers a handled error with is the chain's;
      // what this pins is that the refusal names the capability rather than
      // the surface reporting an empty trend.
      expect(JSON.stringify(body)).toContain("service_unavailable");
    });

    it("refuses a retention plan gate rather than passing one it cannot evaluate", async () => {
      const { half } = composeHalf({ plans: undefined });

      await expect(
        half.ports.dataRetention.assertPlanForProject(
          { session: { user: SESSION_USER } } as never,
          PROJECT_ID,
        ),
      ).rejects.toMatchObject({ code: "service_unavailable" });
    });

    it("refuses to keep data indefinitely for a caller who is not a platform administrator", () => {
      const { half } = composeHalf();

      expect(() =>
        half.ports.dataRetention.assertCanDisableRetention({
          session: { user: SESSION_USER },
        } as never),
      ).toThrow(/platform administrators/);
    });
  });

  describe("when the half did not compose", () => {
    it("passes the base through untouched rather than mounting three namespaces over the gap", () => {
      const base = baseCollaborators();

      expect(withApiProductInfraCollaborators(base, undefined)).toBe(base);
    });
  });
});
