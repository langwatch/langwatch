/**
 * The workbench half of the experiments REST surface, against real Postgres.
 * Every step hands the next one what the previous one produced: slug, version.
 * @see specs/experiments-v3/workbench-versioning.feature
 */
import type { WorkflowService } from "@langwatch/workflow-server";
import type { AgentApi } from "@langwatch/agent-contract";
import type { AuthzService } from "@langwatch/authz-contract";
import type { DatasetService } from "@langwatch/dataset-contract";
import type { EvaluatorApi } from "@langwatch/evaluator-contract";
import type { PersistedEvaluationsV3State } from "@langwatch/experiment-contract";
import {
  ClickHouseExperimentDspyRepository,
  ClickHouseExperimentRunRepository,
  ExperimentApp,
  ExperimentService,
  ExperimentWorkbenchUpdates,
  PrismaExperimentRepository,
  PrismaExperimentWorkflowVersionRepository,
} from "@langwatch/experiment-server";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaQueryGuard,
  type PrismaConnection,
  type PrismaQueryContext,
  type PrismaQueryExecutor,
} from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import type { PromptService } from "@langwatch/prompt-contract";
import { cleanupTestRows } from "@langwatch/test-harness";

import { nanoid } from "nanoid";
import { EventEmitter } from "node:events";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { ApiHandlerManagedCredentials } from "../../app/api-handler-managed-credential.ts";
import type { ApiExperimentV3RestCollaborators } from "../../features/experiment/experiment-v3-rest.mount.ts";
import { allRegisteredRoutes, policyPermissions } from "../index.ts";
import { REST_AUTH_PROJECT, RestAuthWorld } from "./support/rest-auth.world.ts";
import { mountRestFamily, type MountedRestFamily } from "./support/rest-family.harness.ts";

/**
 * This suite writes and reads its own rows and exercises no multi-tenant guard
 * behaviour, so it composes the client without one rather than teaching a guard
 * about rows created ad hoc.
 */
class AllowTestQueries extends PrismaQueryGuard {
  execute(context: PrismaQueryContext, next: PrismaQueryExecutor): Promise<unknown> {
    return next(context.args);
  }
}

/** Every workbench update published, in the order it was published. */
class RecordingWorkbenchUpdates extends ExperimentWorkbenchUpdates {
  readonly published: Parameters<ExperimentWorkbenchUpdates["publish"]>[0][] = [];

  publish(input: Parameters<ExperimentWorkbenchUpdates["publish"]>[0]): Promise<void> {
    this.published.push(input);

    return Promise.resolve();
  }
}

const DB_URL = process.env.LANGWATCH_TEST_DATABASE_URL;
const PROJECT_KEY = "sk-lw-alpha-workbench";
const suffix = nanoid(8);
const ORGANIZATION_ID = `org_workbench_${suffix}`;
const TEAM_ID = `team_workbench_${suffix}`;
const PROJECT_ID = `proj_workbench_${suffix}`;

/** The project the world resolves the key to, and the row that key writes into. */
const PROJECT = { ...REST_AUTH_PROJECT, id: PROJECT_ID, organizationId: ORGANIZATION_ID };

let connection: PrismaConnection | undefined;
let prisma: PrismaClient | undefined;
let updates = new RecordingWorkbenchUpdates();

const stateNamed = (name: string): PersistedEvaluationsV3State =>
  ({
    name,
    datasets: [
      {
        id: "dataset_1",
        name: "Inline",
        type: "inline",
        columns: [{ id: "input", name: "input", type: "string" }],
      },
    ],
    activeDatasetId: "dataset_1",
    evaluators: [],
    targets: [],
  }) as PersistedEvaluationsV3State;

/** A reference service no scenario here reaches; a call is an arrangement bug. */
const unreached = <T>(name: string): T =>
  new Proxy(
    {},
    {
      get: () => () => {
        throw new Error(`${name} is not composed for the workbench REST suite`);
      },
    },
  ) as T;

/**
 * The `/api/experiments` namespace as this process mounts it: the workbench
 * doors, which authenticate in-handler, and the list-and-create doors, which go
 * through the framework chain — over one experiment application, on real rows.
 */
function mount(): MountedRestFamily {
  const world = RestAuthWorld.create({
    projects: [PROJECT],
    keys: [{ token: PROJECT_KEY, projectId: PROJECT_ID, apiKeyId: `key_${suffix}` }],
  });
  const resolveClickHouseClient = () => Promise.resolve(null);
  const tupleParam = (values: string[]) => values as never;
  const runHistoryTelemetry = { warn: () => undefined, error: () => undefined } as never;
  const experiments = ExperimentService.create({
    repository: PrismaExperimentRepository.create(prisma!),
    runRepository: ClickHouseExperimentRunRepository.create({
      workflowVersions: PrismaExperimentWorkflowVersionRepository.create(prisma!),
      resolveClient: resolveClickHouseClient,
      tupleParam,
      telemetry: runHistoryTelemetry,
    }),
    dspyRepository: ClickHouseExperimentDspyRepository.create({
      resolveClient: resolveClickHouseClient,
      retention: { getTraceRetentionDays: () => Promise.resolve(30) } as never,
      telemetry: runHistoryTelemetry,
    }),
    slugify: (value) =>
      value
        .toLowerCase()
        .replaceAll(/[^a-z0-9]+/g, "-")
        .replaceAll(/^-|-$/g, ""),
    newId: () => `experiment_${nanoid(8)}`,
    references: {
      prompts: unreached<PromptService>("The prompt service"),
      agents: unreached<AgentApi>("The agent API"),
      evaluators: unreached<EvaluatorApi>("The evaluator service"),
      workflows: unreached<WorkflowService>("The workflow service"),
      dataset: unreached<DatasetService>("The dataset service"),
    },
    updates,
  });
  const app = ExperimentApp.create({
    experiments,
    workflows: unreached<WorkflowService>("The workflow service"),
    dataset: unreached<DatasetService>("The dataset service"),
    monitors: { deleteForExperiment: () => Promise.resolve(undefined) },
    broadcast: {
      getTenantEmitter: () => new EventEmitter(),
      cleanupTenantEmitter: () => undefined,
    },
  });

  // The process's own credential resolution, over the world's keys: a request
  // with no token is refused by the same code the deployed process runs. What a
  // key may DO is the ceiling suite's subject, so authz answers yes here.
  const credentials = ApiHandlerManagedCredentials.create({
    apiKeys: world.apiKeys(),
    authz: {
      hasApiKeyPermission: () => Promise.resolve(true),
      getApiKeyProjectDecision: () => Promise.resolve({ outcome: "allowed" }),
    } as unknown as AuthzService,
  });

  const workbench: ApiExperimentV3RestCollaborators = {
    session: {
      resolve: () => Promise.resolve(null),
      permitted: () => Promise.resolve(false),
    } as never,
    credential: (input) => credentials.authenticate(input),
    experiments: () => app,
    run: { ports: null, progress: null, services: {} } as never,
  };

  return mountRestFamily({
    security: world.security(),
    services: { experimentWorkbench: workbench },
    packaged: { experiments: () => app } as never,
  });
}

const authorized = { "x-auth-token": PROJECT_KEY };

/**
 * Fixture, not a test: a create that fails here is a broken arrangement, so it
 * throws with the status AND the body rather than asserting.
 */
const createExperiment = async (
  body: unknown = {},
): Promise<{ id: string; slug: string; version: number }> => {
  const response = await mount().post("/api/experiments", body, authorized);
  const text = await response.text();
  if (response.status !== 200) {
    throw new Error(`Arranging an experiment answered ${response.status}: ${text}`);
  }

  return JSON.parse(text) as { id: string; slug: string; version: number };
};

describe.skipIf(!DB_URL)("the experiments workbench REST surface", () => {
  beforeAll(async () => {
    connection = PrismaConnectionService.create({ guard: new AllowTestQueries() }).connect(
      PrismaConfigService.create().resolve({ databaseUrl: DB_URL ?? "", log: ["error"] }),
    );
    prisma = connection.client as PrismaClient;

    await prisma.organization.create({
      data: { id: ORGANIZATION_ID, name: ORGANIZATION_ID, slug: ORGANIZATION_ID },
    });
    await prisma.team.create({
      data: { id: TEAM_ID, name: TEAM_ID, slug: TEAM_ID, organizationId: ORGANIZATION_ID },
    });
    await prisma.project.create({
      data: {
        id: PROJECT_ID,
        name: PROJECT_ID,
        slug: PROJECT_ID,
        teamId: TEAM_ID,
        language: "typescript",
        framework: "other",
        apiKey: `key-${PROJECT_ID}`,
      },
    });
  });

  afterAll(async () => {
    if (!prisma) return;
    await cleanupTestRows(prisma, [
      ["experimentVersion", { projectId: PROJECT_ID }],
      ["experiment", { projectId: PROJECT_ID }],
      ["project", { id: PROJECT_ID }],
      ["team", { id: TEAM_ID }],
      ["organization", { id: ORGANIZATION_ID }],
    ]);
    await prisma.$disconnect();
  });

  describe("given a project API key", () => {
    describe("when the caller creates an experiment with no setup", () => {
      /** @scenario "Creating an experiment over REST gives a workbench you can open" */
      it("creates a blank workbench at version 1", async () => {
        const created = await createExperiment({ name: `Blank ${nanoid(6)}` });

        expect(created.version).toBe(1);
        expect(created.slug).toBeTruthy();

        const read = await mount().get(
          `/api/experiments/${created.slug}/workbench-state`,
          authorized,
        );
        const workbench = (await read.json()) as {
          id: string;
          version: number;
          state: { datasets: unknown[]; targets: unknown[] };
        };

        expect(read.status).toBe(200);
        expect(workbench.id).toBe(created.id);
        expect(workbench.version).toBe(1);
        expect(workbench.state.datasets).toHaveLength(1);
        expect(workbench.state.targets).toHaveLength(0);
      });
    });

    describe("when the create succeeds", () => {
      /** @scenario "A create over REST tells the tenant the list moved" */
      it("publishes the new experiment on the tenant's live channel", async () => {
        updates = new RecordingWorkbenchUpdates();

        const created = await createExperiment({ name: `Broadcast ${nanoid(6)}` });

        expect(updates.published).toEqual([
          {
            projectId: PROJECT_ID,
            experimentId: created.id,
            slug: created.slug,
            version: 1,
            actorLabel: "api",
          },
        ]);
      });
    });

    describe("when the caller walks the whole round trip", () => {
      /** @scenario "An agent edits an experiment through the REST surface" */
      it("creates, reads, saves, lists versions and restores", async () => {
        const created = await createExperiment({ state: stateNamed("First setup") });

        const saved = await mount().put(
          `/api/experiments/${created.slug}/workbench-state`,
          {
            state: stateNamed("Second setup"),
            expectedVersion: created.version,
            commitMessage: "Renamed the setup",
          },
          authorized,
        );
        expect(saved.status).toBe(200);
        expect(await saved.json()).toEqual({ version: 2 });

        const listed = await mount().get(`/api/experiments/${created.slug}/versions`, authorized);
        const history = (await listed.json()) as {
          versions: { version: number; commitMessage: string | null; authorLabel: string }[];
          nextCursor: number | null;
        };

        expect(listed.status).toBe(200);
        expect(history.versions.map((entry) => entry.version)).toEqual([2, 1]);
        expect(history.versions[0]?.commitMessage).toBe("Renamed the setup");
        expect(history.versions[0]?.authorLabel).toBe("api");
        expect(history.nextCursor).toBeNull();

        const restored = await mount().post(
          `/api/experiments/${created.slug}/versions/1/restore`,
          undefined,
          authorized,
        );
        expect(restored.status).toBe(200);
        expect(await restored.json()).toEqual({ version: 3 });

        const afterRestore = await mount().get(
          `/api/experiments/${created.slug}/workbench-state`,
          authorized,
        );
        const workbench = (await afterRestore.json()) as {
          version: number;
          state: { name: string };
        };
        expect(workbench.version).toBe(3);
        expect(workbench.state.name).toBe("First setup");
      });
    });

    describe("when the caller asks for the version field only", () => {
      /** @scenario "A poller checks for changes without pulling the setup" */
      it("answers with the version and leaves the setup out", async () => {
        const created = await createExperiment({ state: stateNamed("Probe me") });

        const response = await mount().get(
          `/api/experiments/${created.slug}/workbench-state?fields=version`,
          authorized,
        );
        const body = (await response.json()) as Record<string, unknown>;

        expect(response.status).toBe(200);
        expect(body.version).toBe(1);
        expect(body.slug).toBe(created.slug);
        expect(body.updatedAt).toEqual(expect.any(String));
        expect(body).not.toHaveProperty("state");
      });
    });

    describe("when a save names a version someone already wrote over", () => {
      /** @scenario "A stale save is refused with the version to read again" */
      it("answers 409 carrying the stale code and the current version", async () => {
        const created = await createExperiment({ state: stateNamed("Racing setup") });

        await mount().put(
          `/api/experiments/${created.slug}/workbench-state`,
          { state: stateNamed("Winner"), expectedVersion: created.version },
          authorized,
        );

        const stale = await mount().put(
          `/api/experiments/${created.slug}/workbench-state`,
          { state: stateNamed("Loser"), expectedVersion: created.version },
          authorized,
        );
        const body = (await stale.json()) as { error: string; currentVersion?: number };

        expect(stale.status).toBe(409);
        expect(body.error).toBe("experiment_stale_workbench_state");
        expect(body.currentVersion).toBe(2);

        const read = await mount().get(
          `/api/experiments/${created.slug}/workbench-state`,
          authorized,
        );
        const workbench = (await read.json()) as { state: { name: string } };
        expect(workbench.state.name).toBe("Winner");
      });
    });

    describe("when a save carries a setup that does not match the schema", () => {
      /** @scenario "A setup that cannot be read is refused with its code" */
      it("answers 400 with the invalid-state code", async () => {
        const created = await createExperiment({ state: stateNamed("Valid to start with") });

        const response = await mount().put(
          `/api/experiments/${created.slug}/workbench-state`,
          { state: { name: "no datasets here" } },
          authorized,
        );
        const body = (await response.json()) as { error: string };

        expect(response.status).toBe(400);
        expect(body.error).toBe("experiment_invalid_workbench_state");
      });
    });

    describe("when the slug belongs to no experiment in this project", () => {
      /** @scenario "An unknown experiment reads as not found" */
      it("answers 404 with the experiment code", async () => {
        const response = await mount().get(
          `/api/experiments/no-such-experiment-${nanoid(6)}/workbench-state`,
          authorized,
        );
        const body = (await response.json()) as { error: string };

        expect(response.status).toBe(404);
        expect(body.error).toBe("experiment_not_found");
      });
    });

    describe("when a restore names a version the experiment never had", () => {
      /** @scenario "A restore of a version that does not exist reads as not found" */
      it("answers 404 with the version code", async () => {
        const created = await createExperiment({ state: stateNamed("Only one version") });

        const response = await mount().post(
          `/api/experiments/${created.slug}/versions/99/restore`,
          undefined,
          authorized,
        );
        const body = (await response.json()) as { error: string };

        expect(response.status).toBe(404);
        expect(body.error).toBe("experiment_version_not_found");
      });
    });

    describe("when a restore names a segment that is not a version number", () => {
      /** @scenario "A restore of a version that does not exist reads as not found" */
      it("answers 404 with a version a caller can parse", async () => {
        const created = await createExperiment({ state: stateNamed("Only one version") });

        const response = await mount().post(
          `/api/experiments/${created.slug}/versions/abc/restore`,
          undefined,
          authorized,
        );
        const body = (await response.json()) as {
          error: string;
          experimentId: string;
          version: unknown;
        };

        expect(response.status).toBe(404);
        expect(body.error).toBe("experiment_version_not_found");
        expect(body.experimentId).toBe(created.id);
        // `Number("abc")` is `NaN`, and JSON writes `NaN` as `null`. A caller
        // that reads `version` as a number has to be able to parse the 404 it
        // just got, so the envelope carries a real number.
        expect(body.version).toBe(0);
      });
    });
  });

  describe("given a request that carries no credentials", () => {
    /** @scenario "The workbench endpoints refuse an unauthenticated caller" */
    it("refuses the create and every workbench door with a 401", async () => {
      const api = mount();

      const statuses = await Promise.all(
        [
          api.post("/api/experiments", {}),
          api.get("/api/experiments/any-slug/workbench-state"),
          api.put("/api/experiments/any-slug/workbench-state", { state: stateNamed("Nope") }),
          api.get("/api/experiments/any-slug/versions"),
          api.post("/api/experiments/any-slug/versions/1/restore"),
        ].map(async (response) => (await response).status),
      );

      expect(statuses).toEqual([401, 401, 401, 401, 401]);
    });
  });

  /**
   * The registry is filled as the family mounts, so mounting it above is what
   * puts these routes in it.
   */
  describe("given the route registry", () => {
    /** @scenario "Each workbench endpoint declares the grain it needs" */
    it.each([
      ["POST", "/api/experiments", "experiments:create"],
      ["GET", "/api/experiments/:slug/workbench-state", "experiments:view"],
      ["PUT", "/api/experiments/:slug/workbench-state", "experiments:update"],
      ["GET", "/api/experiments/:slug/versions", "experiments:view"],
      ["POST", "/api/experiments/:slug/versions/:version/restore", "experiments:update"],
    ])("declares %s %s as %s", (method, path, permission) => {
      mount();

      const route = allRegisteredRoutes().find(
        (registered) => registered.method === method && registered.path.replace(/\/$/, "") === path,
      );

      expect(route).toBeDefined();
      // The WHOLE set the route demands, not its first entry: a route also
      // asking for `admin:everything` would still read as least-privilege if
      // only one entry were checked. `policyPermissions` covers both
      // declaration kinds this namespace holds.
      expect(policyPermissions(route!.policy)).toEqual([permission]);
    });
  });
});
