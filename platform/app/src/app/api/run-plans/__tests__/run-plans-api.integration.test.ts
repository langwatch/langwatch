/**
 * The run plans REST family, end to end over the mounted Hono app.
 *
 * @see specs/api-reference/run-plans-rest-api.feature
 */
import { nanoid } from "nanoid";
import type { Mock } from "vitest";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { projectFactory } from "~/factories/project.factory";
import type {
  Agent,
  Organization,
  Project,
  Scenario,
  SimulationSuite,
  Team,
  User,
} from "~/generated/prisma/client";
import { V1_API_VERSION } from "~/server/api/v1/version";
import { generateApiKeyToken } from "~/server/api-key/api-key-token.utils";
import { globalForApp, resetApp } from "~/server/app-layer/app";
import { createTestApp } from "~/server/app-layer/presets";
import {
  type PlanProvider,
  PlanProviderService,
} from "~/server/app-layer/subscription/plan-provider";
import { SuiteRunService } from "~/server/app-layer/suites/suite-run.service";
import { prisma } from "~/server/db";
import type { QueueRunCommandData } from "~/server/event-sourcing/pipelines/simulation-processing/schemas/commands";
import type { StartSuiteRunCommandData } from "~/server/event-sourcing/pipelines/suite-run-processing/schemas/commands";
import { cleanupTestRows } from "~/test-utils/cleanupTestRows";
import { FREE_PLAN } from "../../../../../ee/licensing/constants";
import { app } from "../[[...route]]/app";

const BASE = "/api/v1/run-plans";

describe("Feature: Run Plans REST API", () => {
  let testApiKey: string;
  let testProjectId: string;
  let testOrganization: Organization;
  let testTeam: Team;
  let testProject: Project;
  let startSuiteRun: Mock<(data: StartSuiteRunCommandData) => Promise<void>>;
  let queueSimulationRun: Mock<(data: QueueRunCommandData) => Promise<void>>;
  let testUserIds: string[];
  let testApiKeyIds: string[];

  const headers = (extra: Record<string, string> = {}) => ({
    "X-Auth-Token": testApiKey,
    "Content-Type": "application/json",
    ...extra,
  });

  const api = {
    get: (path: string, extra: Record<string, string> = {}) =>
      app.request(path, { headers: headers(extra) }),
    post: (path: string, body: unknown, extra: Record<string, string> = {}) =>
      app.request(path, {
        method: "POST",
        headers: headers(extra),
        body: JSON.stringify(body),
      }),
    delete: (path: string) =>
      app.request(path, { method: "DELETE", headers: headers() }),
  };

  beforeEach(async () => {
    await resetApp();
    const mockGetActivePlan = vi.fn().mockResolvedValue(FREE_PLAN);
    startSuiteRun = vi.fn(async () => {});
    queueSimulationRun = vi.fn(async () => {});
    globalForApp.__langwatch_app = createTestApp({
      planProvider: PlanProviderService.create({
        getActivePlan: mockGetActivePlan as PlanProvider["getActivePlan"],
      }),
      usageLimits: {
        notifyPlanLimitReached: vi.fn().mockResolvedValue(undefined),
        checkAndSendWarning: vi.fn().mockResolvedValue(undefined),
      } as any,
      // The API-key ceiling has its own tests. What these need from a scoped
      // key is only that it reaches the handler carrying the user it belongs
      // to, so the ceiling is stood up open rather than seeded with role
      // bindings that would test RBAC a second time.
      permissions: {
        hasApiKeyPermission: async () => true,
      } as any,
      // The run routes reach the event stream through this service, so
      // standing it up on spies is what lets a test read the commands a run
      // actually dispatched.
      suiteRuns: {
        runs: SuiteRunService.create({
          resolveClickHouseClient: null,
          startSuiteRun,
          queueSimulationRun,
        }),
      },
    });

    testOrganization = await prisma.organization.create({
      data: { name: "Test Organization", slug: `test-org-${nanoid()}` },
    });
    testTeam = await prisma.team.create({
      data: {
        name: "Test Team",
        slug: `test-team-${nanoid()}`,
        organizationId: testOrganization.id,
      },
    });
    testProject = await prisma.project.create({
      data: {
        ...projectFactory.build({ slug: nanoid() }),
        teamId: testTeam.id,
        personalFeatures: {},
      },
    });
    testApiKey = testProject.apiKey;
    testProjectId = testProject.id;
    testUserIds = [];
    testApiKeyIds = [];
  });

  afterEach(async () => {
    await cleanupTestRows(prisma, [
      ["simulationSuite", { projectId: testProjectId }],
      ["scenario", { projectId: testProjectId }],
      ["agent", { projectId: testProjectId }],
      ...(testApiKeyIds.length > 0
        ? ([["apiKey", { id: { in: testApiKeyIds } }]] as const)
        : []),
    ]);
    await prisma.project.delete({ where: { id: testProjectId } });
    await prisma.team.delete({ where: { id: testTeam.id } });
    await prisma.organization.delete({ where: { id: testOrganization.id } });
    if (testUserIds.length > 0) {
      await cleanupTestRows(prisma, [["user", { id: { in: testUserIds } }]]);
    }
    await resetApp();
  });

  // ── fixtures ───────────────────────────────────────────────────────────────

  async function createScenario(name: string): Promise<Scenario> {
    return prisma.scenario.create({
      data: {
        projectId: testProjectId,
        name,
        situation: `Testing ${name}`,
        criteria: ["criterion_1"],
        labels: [],
      },
    });
  }

  async function createAgent(name = "dev-agent"): Promise<Agent> {
    return prisma.agent.create({
      data: {
        projectId: testProjectId,
        name,
        type: "http",
        config: {
          url: "https://example.com/chat",
          method: "POST",
          headers: [],
          bodyTemplate: '{"message": "{{input}}"}',
        },
      },
    });
  }

  async function createPlan(
    overrides: Partial<{
      name: string;
      scenarioIds: string[];
      targets: unknown;
      archivedAt: Date | null;
    }> = {},
  ): Promise<SimulationSuite> {
    const scenario = await createScenario(`case-${nanoid(6)}`);
    return prisma.simulationSuite.create({
      data: {
        id: `suite_${nanoid()}`,
        projectId: testProjectId,
        name: overrides.name ?? "Nightly",
        slug: `nightly-${nanoid(6)}`,
        scenarioIds: overrides.scenarioIds ?? [scenario.id],
        targets: overrides.targets ?? [
          { type: "http", referenceId: "agent_test" },
        ],
        repeatCount: 1,
        labels: [],
        archivedAt: overrides.archivedAt ?? null,
      },
    });
  }

  async function createFolder(name: string): Promise<SimulationSuite> {
    return prisma.simulationSuite.create({
      data: {
        id: `suite_${nanoid()}`,
        projectId: testProjectId,
        name,
        slug: `${name.toLowerCase()}-${nanoid(6)}`,
        kind: "folder",
        scenarioIds: [],
        targets: [],
        labels: [],
      },
    });
  }

  /** A runnable configuration: one scenario, one agent. */
  async function runnable(): Promise<{ scenario: Scenario; agent: Agent }> {
    return {
      scenario: await createScenario("Refund Flow"),
      agent: await createAgent(),
    };
  }

  /** A key bound to a person, so a run records an actor. */
  async function createUserKey(): Promise<{ user: User; token: string }> {
    const user = await prisma.user.create({
      data: { name: "Runner", email: `runner-${nanoid(6)}@example.com` },
    });
    testUserIds.push(user.id);
    const { token, lookupId, hashedSecret } = generateApiKeyToken();
    const key = await prisma.apiKey.create({
      data: {
        name: `runner key ${nanoid(6)}`,
        lookupId,
        hashedSecret,
        userId: user.id,
        organizationId: testOrganization.id,
      },
    });
    testApiKeyIds.push(key.id);
    return { user, token };
  }

  // ── list ───────────────────────────────────────────────────────────────────

  describe("given the project holds one active plan and one archived plan", () => {
    describe("when the run plans are listed", () => {
      /** @scenario "Listing run plans leaves out archived plans" */
      it("returns only the active plan", async () => {
        const active = await createPlan({ name: "Nightly" });
        await createPlan({ name: "Old", archivedAt: new Date() });

        const res = await api.get(BASE);

        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.map((plan: { id: string }) => plan.id)).toEqual([
          active.id,
        ]);
        expect(body[0].platformUrl).toContain(active.slug);
      });

      /** @scenario "Listing run plans includes archived plans when asked" */
      it("returns both when includeArchived is set", async () => {
        await createPlan({ name: "Nightly" });
        await createPlan({ name: "Old", archivedAt: new Date() });

        const res = await api.get(`${BASE}?includeArchived=true`);

        expect(res.status).toBe(200);
        expect((await res.json()).length).toBe(2);
      });
    });
  });

  describe("given the project holds one run plan and one test suite", () => {
    /** @scenario "Listing run plans leaves out test suites" */
    it("returns only the run plan", async () => {
      const plan = await createPlan({ name: "Nightly" });
      await createFolder("Refunds");

      const res = await api.get(BASE);

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.map((one: { id: string }) => one.id)).toEqual([plan.id]);
    });
  });

  // ── read ───────────────────────────────────────────────────────────────────

  describe("given an id the project does not hold", () => {
    /** @scenario "Reading a run plan that does not exist answers suite_not_found" */
    it("answers 404 naming the code", async () => {
      const res = await api.get(`${BASE}/suite_nonexistent`);

      expect(res.status).toBe(404);
      expect((await res.json()).code).toBe("suite_not_found");
    });
  });

  describe("given the id names a test suite", () => {
    /** @scenario "Reading a test suite through the run plan route answers suite_not_found" */
    it("answers 404 naming the code", async () => {
      const folder = await createFolder("Refunds");

      const res = await api.get(`${BASE}/${folder.id}`);

      expect(res.status).toBe(404);
      expect((await res.json()).code).toBe("suite_not_found");
    });
  });

  // ── run a configuration ────────────────────────────────────────────────────

  describe("given a configuration over one scenario and one agent", () => {
    describe("when it is run under a name nothing answers to", () => {
      /** @scenario "Running a configuration creates the run plan its name resolves" */
      it("creates the plan and schedules the runs", async () => {
        const { scenario, agent } = await runnable();

        const res = await api.post(`${BASE}/run`, {
          name: "Nightly",
          config: {
            scope: { mode: "cases" },
            scenarioIds: [scenario.id],
            targets: [{ type: "http", referenceId: agent.id }],
          },
          idempotencyKey: "run-plan-key-1",
        });

        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body).toMatchObject({
          scheduled: true,
          jobCount: 1,
          planName: "Nightly",
          created: true,
        });
        expect(queueSimulationRun).toHaveBeenCalledTimes(1);
        expect(startSuiteRun).toHaveBeenCalledWith(
          expect.objectContaining({
            batchRunId: body.batchRunId,
            idempotencyKey: "run-plan-key-1",
          }),
        );
        const stored = await prisma.simulationSuite.findFirst({
          where: { id: body.runPlanId, projectId: testProjectId },
        });
        expect(stored?.name).toBe("Nightly");
        expect(stored?.kind).toBe("custom");
        // Both interfaces open a run plan on a page of its own, so the link
        // names the plan either way. Whether it carries a scheme is a
        // property of BASE_HOST, which `shared/__tests__/platform-url.unit.test.ts`
        // owns.
        expect(body.platformUrl).toContain(stored?.slug);
      });
    });

    describe("when the same name is run twice", () => {
      /** @scenario "Running the same name twice joins the run plan already there" */
      it("joins the plan the first run resolved", async () => {
        const { scenario, agent } = await runnable();
        const config = {
          scope: { mode: "cases" },
          scenarioIds: [scenario.id],
          targets: [{ type: "http", referenceId: agent.id }],
        };

        const first = await api.post(`${BASE}/run`, {
          name: "Nightly",
          config,
          idempotencyKey: "run-plan-key-2a",
        });
        const second = await api.post(`${BASE}/run`, {
          name: "Nightly",
          config,
          idempotencyKey: "run-plan-key-2b",
        });

        expect(second.status).toBe(200);
        const firstBody = await first.json();
        const secondBody = await second.json();
        expect(secondBody.created).toBe(false);
        expect(secondBody.runPlanId).toBe(firstBody.runPlanId);
      });
    });

    describe("when the key behind the run belongs to no person", () => {
      /** @scenario "A run started with a key that names no person records no actor" */
      it("records no actor on the queued run", async () => {
        const { scenario, agent } = await runnable();

        const res = await api.post(`${BASE}/run`, {
          config: {
            scope: { mode: "cases" },
            scenarioIds: [scenario.id],
            targets: [{ type: "http", referenceId: agent.id }],
          },
          idempotencyKey: "run-plan-actor-1",
        });

        expect(res.status).toBe(200);
        const langwatch = (
          queueSimulationRun.mock.calls[0]![0].metadata as {
            langwatch: Record<string, unknown>;
          }
        ).langwatch;
        expect(langwatch).not.toHaveProperty("actorId");
        expect(langwatch).not.toHaveProperty("actorLabel");
      });
    });

    describe("when the key behind the run belongs to a person", () => {
      /** @scenario "A run started with a key that names a person records the api actor" */
      it("records the api actor on the queued run", async () => {
        const { scenario, agent } = await runnable();
        const { user, token } = await createUserKey();

        const res = await app.request(`${BASE}/run`, {
          method: "POST",
          headers: {
            "X-Auth-Token": token,
            "X-Project-Id": testProjectId,
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            config: {
              scope: { mode: "cases" },
              scenarioIds: [scenario.id],
              targets: [{ type: "http", referenceId: agent.id }],
            },
            idempotencyKey: "run-plan-actor-2",
          }),
        });

        expect(res.status).toBe(200);
        const langwatch = (
          queueSimulationRun.mock.calls[0]![0].metadata as {
            langwatch: Record<string, unknown>;
          }
        ).langwatch;
        expect(langwatch).toMatchObject({
          actorId: user.id,
          actorLabel: "api",
        });
      });

      /** @scenario "A run started from the command line records the cli actor" */
      it("records the cli actor when the surface header says so", async () => {
        const { scenario, agent } = await runnable();
        const { user, token } = await createUserKey();

        const res = await app.request(`${BASE}/run`, {
          method: "POST",
          headers: {
            "X-Auth-Token": token,
            "X-Project-Id": testProjectId,
            "Content-Type": "application/json",
            "X-LangWatch-Surface": "cli",
          },
          body: JSON.stringify({
            config: {
              scope: { mode: "cases" },
              scenarioIds: [scenario.id],
              targets: [{ type: "http", referenceId: agent.id }],
            },
            idempotencyKey: "run-plan-actor-3",
          }),
        });

        expect(res.status).toBe(200);
        const langwatch = (
          queueSimulationRun.mock.calls[0]![0].metadata as {
            langwatch: Record<string, unknown>;
          }
        ).langwatch;
        expect(langwatch).toMatchObject({
          actorId: user.id,
          actorLabel: "cli",
        });
      });
    });

    describe("when it names no target", () => {
      /** @scenario "Running a configuration with no target is refused with suite_targets_required" */
      it("answers 422 suite_targets_required and schedules nothing", async () => {
        const scenario = await createScenario("Refund Flow");

        const res = await api.post(`${BASE}/run`, {
          config: {
            scope: { mode: "cases" },
            scenarioIds: [scenario.id],
            targets: [],
          },
          idempotencyKey: "run-plan-key-3",
        });

        expect(res.status).toBe(422);
        expect((await res.json()).code).toBe("suite_targets_required");
        expect(startSuiteRun).not.toHaveBeenCalled();
        expect(queueSimulationRun).not.toHaveBeenCalled();
      });
    });
  });

  // ── run a stored plan ──────────────────────────────────────────────────────

  describe("given a stored run plan", () => {
    async function createRunnablePlan() {
      const { scenario, agent } = await runnable();
      const plan = await prisma.simulationSuite.create({
        data: {
          id: `suite_${nanoid()}`,
          projectId: testProjectId,
          name: "Runnable plan",
          slug: `runnable-plan-${nanoid(6)}`,
          scenarioIds: [scenario.id],
          targets: [{ type: "http", referenceId: agent.id }],
          repeatCount: 1,
          labels: [],
        },
      });
      return plan;
    }

    /** @scenario "Running a stored run plan again runs the configuration it holds" */
    it("schedules the runs it already holds", async () => {
      const plan = await createRunnablePlan();

      const res = await api.post(`${BASE}/${plan.id}/run`, {
        idempotencyKey: "rerun-key-1",
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toMatchObject({
        scheduled: true,
        jobCount: 1,
        runPlanId: plan.id,
        planName: "Runnable plan",
        created: false,
      });
      expect(queueSimulationRun).toHaveBeenCalledTimes(1);
    });

    /** @scenario "Running a stored run plan that does not exist answers suite_not_found" */
    it("answers 404 for an id the project does not hold", async () => {
      const res = await api.post(`${BASE}/suite_nonexistent/run`, {});

      expect(res.status).toBe(404);
      expect((await res.json()).code).toBe("suite_not_found");
    });
  });

  // ── archive ────────────────────────────────────────────────────────────────

  describe("given a run plan the project holds", () => {
    /** @scenario "Archiving a run plan hides it from the list" */
    it("archives it and drops it from the list", async () => {
      const plan = await createPlan({ name: "To archive" });

      const res = await api.delete(`${BASE}/${plan.id}`);

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ id: plan.id, archived: true });

      const list = await api.get(BASE);
      const ids = (await list.json()).map((one: { id: string }) => one.id);
      expect(ids).not.toContain(plan.id);
    });
  });

  // ── versioning ─────────────────────────────────────────────────────────────

  describe("given the family's version namespaces", () => {
    /** @scenario "A dated run plans path and the bare alias both answer" */
    it("answers the same on the dated path and the bare alias", async () => {
      const plan = await createPlan({ name: "Nightly" });

      const dated = await api.get(`${BASE}/${V1_API_VERSION}/`);
      const bare = await api.get(BASE);

      expect(dated.status).toBe(200);
      expect(bare.status).toBe(200);
      const datedIds = (await dated.json()).map(
        (one: { id: string }) => one.id,
      );
      const bareIds = (await bare.json()).map((one: { id: string }) => one.id);
      expect(datedIds).toEqual([plan.id]);
      expect(datedIds).toEqual(bareIds);
    });

    /** @scenario "An unknown run plans version segment answers 404" */
    it("answers 404 for a version segment the family never served", async () => {
      const res = await api.get(`${BASE}/2020-01-01/`);

      expect(res.status).toBe(404);
    });
  });

  describe("given no credential", () => {
    it("answers 401", async () => {
      const res = await app.request(BASE, {
        headers: { "X-Auth-Token": "invalid-key" },
      });

      expect(res.status).toBe(401);
    });
  });
});
