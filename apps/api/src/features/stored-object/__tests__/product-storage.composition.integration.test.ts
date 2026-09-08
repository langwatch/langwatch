/**
 * A project's own storage, retention and monitoring, served by the API process.
 */
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { AuthzService } from "@langwatch/authz-contract";
import type { AgentApi } from "@langwatch/agent-contract";
import type { DataRetentionApi } from "@langwatch/data-retention-contract";
import type { EvaluatorService } from "@langwatch/evaluator-contract";
import { PostgresMonitorAdapter } from "@langwatch/monitor-server";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { createApiFixture } from "@langwatch/test-harness/api-fixture";
import { describe, expect, it, vi } from "vitest";
import { ApiApplication } from "../../../api.application.ts";
import type { ApiStoredObjectsConfigResolution } from "../../../platform/config/api.config.ts";
import { ApiTrpcFeaturesComposition } from "../../../app/api-trpc-features.composition.ts";
import { createDataRetentionTrpcRouter } from "../../data-retention/data-retention-trpc.mount.ts";
import type { ComposedDataRetentionFeature } from "../../data-retention/data-retention.composition.types.ts";
import { composeMonitorFeature } from "../../monitor/monitor.composition.ts";
import { installApiStoredObject } from "../stored-object.composition.ts";
import {
  stubCollaborators,
  stubComposedFeatures,
  stubInfrastructureEntitlements,
} from "../../../app/__tests__/api-trpc-record.test-doubles.ts";

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
      projects: new Map(projects.map(({ projectId }) => [projectId, projectId === PROJECT_ID])),
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

/**
 * The routed ClickHouse connection the object repository reads through.
 */
/** The rows the trend query answers with: one day inside the current window and one i */
function performanceRows(params: Record<string, unknown>): Array<Record<string, unknown>> {
  const evaluatorIds = (params.evaluatorIds as string[] | undefined) ?? [];
  return evaluatorIds.flatMap((evaluatorId) => [
    {
      EvaluatorId: evaluatorId,
      Period: "current",
      Day: "2026-09-02",
      ScoreSum: 1.5,
      ScoreCount: "2",
      PassSum: "1",
      PassCount: "2",
    },
    {
      EvaluatorId: evaluatorId,
      Period: "previous",
      Day: "2026-08-26",
      ScoreSum: 1,
      ScoreCount: "4",
      PassSum: "1",
      PassCount: "4",
    },
  ]);
}

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
  // The two reads this half runs on one routed connection: the object probe,
  // keyed by id, and the monitors page's seven-day trend over
  // `evaluation_runs`. Told apart by the statement rather than by a flag,
  // because that is what the composition decides between.
  const resolveClient = vi.fn(async () => ({
    query: async ({
      query,
      query_params,
    }: {
      query: string;
      query_params: Record<string, unknown>;
    }) => {
      if (query.includes("evaluation_runs")) {
        return { json: async () => performanceRows(query_params) };
      }
      const row = rows.get(String(query_params.id));
      return { json: async () => (row ? [row] : []) };
    },
    insert: async () => undefined,
    exec: async () => undefined,
  }));
  return { resolveClient: resolveClient as unknown as (projectId: string) => Promise<unknown> };
}

/** The retention service the settings page reads through. */
function testDataRetention(): DataRetentionApi {
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
  } as unknown as DataRetentionApi;
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
    azureSpoolRetentionConfirmed: false,
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
    azureSpoolRetentionConfirmed: true,
    routes: new Map(),
  };
}

/** The organization's plan, as every retention gate reads it. */
const PAID_PLAN = { free: false, type: "LAUNCH" } as never;

async function composeHalf(
  options: {
    plans?: undefined;
    storage?: ApiStoredObjectsConfigResolution;
    resolveClickHouseClient?: null;
  } = {},
) {
  const storage = testObjectStorage();
  const prisma = testPrisma();
  const authz = testAuthz();
  const clickHouse = testClickHouse(storage);
  const { storage: storageConfig, ...rest } = options;

  const infrastructure = {
    ...stubInfrastructureEntitlements(),
    prisma: prisma.client,
    authz,
    plans: { getActivePlan: async () => PAID_PLAN },
    audit: undefined,
    ...("plans" in rest ? { plans: rest.plans } : {}),
  };

  const storedObject = await installApiStoredObject({
    prisma: prisma.client,
    resolveClickHouseClient:
      "resolveClickHouseClient" in rest ? rest.resolveClickHouseClient! : clickHouse.resolveClient,
    storage: storageConfig ?? testStorageConfig(),
  });
  const monitor = composeMonitorFeature({
    peers: {
      // The REAL monitor service, over the same double: what this pins is that
      // `monitors.*` answers from the service the execution half composed
      // rather than from a second one built here.
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
    },
    resolveClickHouseClient:
      "resolveClickHouseClient" in rest ? rest.resolveClickHouseClient! : clickHouse.resolveClient,
  });
  // The retention namespace over the answers this suite drives. The installer
  // boots its own app over a real connection, which this world does not have;
  // the wire names and the windows behind them are the ones under test.
  const dataRetention: ComposedDataRetentionFeature = {
    service: testDataRetention(),
    router: (mount) => createDataRetentionTrpcRouter(mount.runtime),
  };

  return {
    dataRetention,
    monitor,
    storedObject,
    infrastructure,
    storage,
    prisma,
    authz,
    clickHouse,
  };
}

async function composeApplication(
  options: {
    plans?: undefined;
    storage?: ApiStoredObjectsConfigResolution;
    resolveClickHouseClient?: null;
  } = {},
) {
  const composed = await composeHalf(options);

  const features = ApiTrpcFeaturesComposition.tryCompose({
    composed: {
      ...stubComposedFeatures(),
      dataRetention: composed.dataRetention,
      monitor: composed.monitor,
      storedObject: composed.storedObject,
    },
    infrastructure: composed.infrastructure,
    collaborators: stubCollaborators({
      monitors: composed.monitor.app,
      storedObjectApp: composed.storedObject.app,
    }),
  });
  if (!features) throw new Error("the record refused to compose against its collaborators");

  const application = ApiApplication.create({
    agents: createApiFixture<AgentApi>(),
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
          body: JSON.stringify(input),
        })
      : await application.hono.request(`${url}?input=${encodeURIComponent(JSON.stringify(input))}`);
  return { status: response.status, body: await response.json() };
}

describe("given an API process composed with the object store, retention and monitor features", () => {
  describe("when the renderer probes a stored object it holds an id for", () => {
    it("reports the object available, having read the row and the bytes", async () => {
      const { application } = await composeApplication();

      const { status, body } = await callTrpc(application, "storedObjects.headById", {
        projectId: PROJECT_ID,
        id: OBJECT_ID,
      });

      expect(status).toBe(200);
      expect(body).toMatchObject({
        result: { data: { status: "available", mediaType: "image/png" } },
      });
    });

    describe("and the row is there but the bytes are gone", () => {
      it("reports it missing rather than not found, which is what the placeholder renders", async () => {
        const { application } = await composeApplication();

        const { body } = await callTrpc(application, "storedObjects.headById", {
          projectId: PROJECT_ID,
          id: MISSING_OBJECT_ID,
        });

        expect(body).toMatchObject({
          result: { data: { status: "missing", mediaType: "audio/wav" } },
        });
      });
    });

    describe("and this deployment keeps its bytes in Azure Blob", () => {
      /**
       * The registry registers the Azure driver as a factory, so nothing is
       * constructed until an `azure-blob://` URI is read. This pins that
       * reading one reaches Azure, rather than being refused by scheme or
       * answered by the S3 driver (which would report a file gone that isn't).
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
          const { application } = await composeApplication({ storage: azureStorageConfig() });

          const { status, body } = await callTrpc(application, "storedObjects.headById", {
            projectId: PROJECT_ID,
            id: AZURE_OBJECT_ID,
          });

          expect(status).toBe(200);
          expect(body).toMatchObject({
            result: { data: { status: "available", mediaType: "image/jpeg" } },
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
       * The credential resolver refuses by name rather than the read
       * reporting the object gone: a deployment missing its Azure config has
       * files it cannot reach, not files that were deleted.
       */
      it("refuses rather than reporting the file missing", async () => {
        const { application } = await composeApplication();

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
        const { application } = await composeApplication();

        const { body } = await callTrpc(application, "storedObjects.headById", {
          projectId: PROJECT_ID,
          id: "so_never_existed",
        });

        expect(body).toMatchObject({ result: { data: { status: "not_found" } } });
      });
    });
  });

  describe("when the retention settings page is opened", () => {
    it("offers only the scopes the caller may write, and lists no rule they may not read", async () => {
      const { application } = await composeApplication();

      const { status, body } = await callTrpc(application, "dataRetention.getRules", {
        projectId: PROJECT_ID,
      });

      expect(status).toBe(200);
      const snapshot = (body as { result: { data: Record<string, unknown> } }).result.data;

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
      const { application } = await composeApplication();

      const { status, body } = await callTrpc(application, "dataRetention.getScopeStorageUsage", {
        projectId: PROJECT_ID,
        scope: { scopeType: "ORGANIZATION", scopeId: ORGANIZATION_ID },
      });

      expect(status).toBe(200);
      // Two projects are in the organization; one is readable, so the rollup
      // reports one rather than widening to what the scope contains.
      expect(body).toMatchObject({
        result: { data: { totalBytes: 1_000, projectCount: 1 } },
      });
    });
  });

  describe("when the monitors page lists a project's evaluations", () => {
    it("answers from the same monitor service the experiment application writes through", async () => {
      const { application, prisma } = await composeApplication();

      const { status, body } = await callTrpc(application, "monitors.getAllForProject", {
        projectId: PROJECT_ID,
      });

      expect(status).toBe(200);
      expect(body).toMatchObject({
        result: { data: [{ id: "monitor-1", name: "Toxicity" }] },
      });
      expect(prisma.client.monitor.findMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { projectId: PROJECT_ID } }),
      );
    });
  });

  describe("when the monitors page charts a project's seven-day trend", () => {
    it("answers it off the routed ClickHouse rather than refusing by name", async () => {
      const { application, clickHouse } = await composeApplication();

      const { status, body } = await callTrpc(application, "monitors.getPerformanceForProject", {
        projectId: PROJECT_ID,
      });

      expect(status).toBe(200);
      // The composed read, folded by the evaluation package's own service:
      // this evaluator is a guardrail, so its trend is the pass rate — 1 of 2
      // this week against 1 of 4 last week. Before this was composed the same
      // call refused with `service_unavailable`.
      expect(body).toMatchObject({
        result: {
          data: [{ monitorId: "monitor-1", metric: "pass_rate", current: 0.5, previous: 0.25 }],
        },
      });
      expect(clickHouse.resolveClient).toHaveBeenCalledWith(PROJECT_ID);
    });
  });

  describe("when a capability this deployment did not compose is reached", () => {
    it("refuses the performance trend by name on a deployment with no ClickHouse", async () => {
      const { application } = await composeApplication({ resolveClickHouseClient: null });

      const { body } = await callTrpc(application, "monitors.getPerformanceForProject", {
        projectId: PROJECT_ID,
      });

      // The status the tRPC lane answers a handled error with is the chain's;
      // what this pins is that the refusal names the capability rather than
      // the surface reporting an empty trend, which a person acts on by
      // switching a monitor off.
      expect(JSON.stringify(body)).toContain("service_unavailable");
    });

    it("refuses a retention plan gate rather than passing one it cannot evaluate", async () => {
      const { application } = await composeApplication({ plans: undefined });

      const { status, body } = await callTrpc(
        application,
        "dataRetention.triggerRetroactiveUpdate",
        { projectId: PROJECT_ID, category: "traces" },
        "mutation",
      );

      // A plan gate that cannot read a plan must not pass: with no provider it
      // refuses by name rather than letting the write through unmetered.
      expect(status).toBeGreaterThanOrEqual(400);
      expect(JSON.stringify(body)).toContain("service_unavailable");
    });

    it("refuses to keep data indefinitely for a caller who is not a platform administrator", async () => {
      const { application } = await composeApplication();

      const { status, body } = await callTrpc(
        application,
        "dataRetention.setForScope",
        {
          projectId: PROJECT_ID,
          scope: { scopeType: "PROJECT", scopeId: PROJECT_ID },
          category: "traces",
          // The keep-forever sentinel, which the schema accepts structurally
          // and only the platform-administrator check refuses.
          retentionDays: 0,
        },
        "mutation",
      );

      expect(status).toBeGreaterThanOrEqual(400);
      expect(JSON.stringify(body)).toContain("FORBIDDEN");
    });
  });

  describe("when the deployment composed no byte backend", () => {
    /**
     * A process installs a feature or it does not, so the refusal comes from
     * the capability genuinely missing: with no ClickHouse connection the
     * probe cannot read a row, and says so by name.
     */
    it("refuses the object probe by name", async () => {
      const { application } = await composeApplication({ resolveClickHouseClient: null });

      const { status, body } = await callTrpc(application, "storedObjects.headById", {
        projectId: PROJECT_ID,
        id: OBJECT_ID,
      });

      expect(status).toBeGreaterThanOrEqual(400);
      expect(JSON.stringify(body)).toContain("service_unavailable");
    });

    it("still answers the retention settings, which never read a byte", async () => {
      const { application } = await composeApplication({ resolveClickHouseClient: null });

      const { status } = await callTrpc(application, "dataRetention.getRules", {
        projectId: PROJECT_ID,
      });

      expect(status).toBe(200);
    });

    it("still lists the project's monitors", async () => {
      const { application } = await composeApplication({ resolveClickHouseClient: null });

      const { status } = await callTrpc(application, "monitors.getAllForProject", {
        projectId: PROJECT_ID,
      });

      expect(status).toBe(200);
    });
  });
});
