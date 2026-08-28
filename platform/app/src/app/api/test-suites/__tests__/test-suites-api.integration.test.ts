/**
 * The test suites REST family, end to end over the mounted Hono app.
 *
 * @see specs/api-reference/test-suites-rest-api.feature
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
} from "~/generated/prisma/client";
import { V1_API_VERSION } from "~/server/api/v1/version";
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

const BASE = "/api/v1/test-suites";

describe("Feature: Test Suites REST API", () => {
  let testApiKey: string;
  let testProjectId: string;
  let testOrganization: Organization;
  let testTeam: Team;
  let testProject: Project;
  let startSuiteRun: Mock<(data: StartSuiteRunCommandData) => Promise<void>>;
  let queueSimulationRun: Mock<(data: QueueRunCommandData) => Promise<void>>;

  const headers = () => ({
    "X-Auth-Token": testApiKey,
    "Content-Type": "application/json",
  });

  const api = {
    get: (path: string) => app.request(path, { headers: headers() }),
    post: (path: string, body: unknown) =>
      app.request(path, {
        method: "POST",
        headers: headers(),
        body: JSON.stringify(body),
      }),
    patch: (path: string, body: unknown) =>
      app.request(path, {
        method: "PATCH",
        headers: headers(),
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
      // The run route reaches the event stream through this service, so
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
  });

  afterEach(async () => {
    await cleanupTestRows(prisma, [
      ["simulationSuite", { projectId: testProjectId }],
      ["scenario", { projectId: testProjectId }],
      ["agent", { projectId: testProjectId }],
    ]);
    await prisma.project.delete({ where: { id: testProjectId } });
    await prisma.team.delete({ where: { id: testTeam.id } });
    await prisma.organization.delete({ where: { id: testOrganization.id } });
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

  /** A test suite with `count` scenarios filed into it. */
  async function createFolderWithCases(
    name: string,
    count: number,
  ): Promise<{ folder: SimulationSuite; cases: Scenario[] }> {
    const folder = await createFolder(name);
    const cases: Scenario[] = [];
    for (let index = 0; index < count; index++) {
      const scenario = await createScenario(`${name} case ${index}`);
      await prisma.scenario.updateMany({
        where: { id: scenario.id, projectId: testProjectId },
        data: { folderId: folder.id },
      });
      cases.push(scenario);
    }
    await prisma.simulationSuite.updateMany({
      where: { id: folder.id, projectId: testProjectId },
      data: { scenarioIds: cases.map((one) => one.id) },
    });
    const stored = await prisma.simulationSuite.findFirstOrThrow({
      where: { id: folder.id, projectId: testProjectId },
    });
    return { folder: stored, cases };
  }

  async function createPlan(name: string): Promise<SimulationSuite> {
    const scenario = await createScenario(`${name} case`);
    return prisma.simulationSuite.create({
      data: {
        id: `suite_${nanoid()}`,
        projectId: testProjectId,
        name,
        slug: `${name.toLowerCase()}-${nanoid(6)}`,
        scenarioIds: [scenario.id],
        targets: [{ type: "http", referenceId: "agent_test" }],
        repeatCount: 1,
        labels: [],
      },
    });
  }

  // ── list ───────────────────────────────────────────────────────────────────

  describe("given the project holds one test suite and one run plan", () => {
    /** @scenario "Listing test suites returns the test suites only" */
    it("returns the test suite alone", async () => {
      const folder = await createFolder("Refunds");
      await createPlan("Nightly");

      const res = await api.get(BASE);

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.map((one: { id: string }) => one.id)).toEqual([folder.id]);
      expect(body[0].scenarioCount).toBe(0);
      // Which page the link opens is decided per project by the Agent
      // Testing flag, and the Simulations interface has no page for one test
      // suite, so the suite slug is in the link only under Agent Testing.
      // What holds either way is that the link is project-scoped; both
      // interfaces are pinned in
      // `src/server/suites/__tests__/platform-path.unit.test.ts`.
      expect(body[0].platformUrl).toContain(`/${testProject.slug}/`);
    });
  });

  // ── create ─────────────────────────────────────────────────────────────────

  describe("given a name for a new test suite", () => {
    /** @scenario "Creating a test suite creates it empty" */
    it("creates it with no scenario", async () => {
      const res = await api.post(BASE, { name: "Refunds" });

      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.name).toBe("Refunds");
      expect(body.scenarioIds).toEqual([]);
      expect(body.scenarioCount).toBe(0);
      expect(body.archivedAt).toBeNull();
    });
  });

  // ── read ───────────────────────────────────────────────────────────────────

  describe("given a test suite holding two scenarios", () => {
    /** @scenario "Reading a test suite names the scenarios filed in it" */
    it("names both scenarios", async () => {
      const { folder, cases } = await createFolderWithCases("Refunds", 2);

      const res = await api.get(`${BASE}/${folder.id}`);

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.scenarioCount).toBe(2);
      expect(body.scenarios.map((one: { id: string }) => one.id)).toEqual(
        cases.map((one) => one.id),
      );
      expect(body.scenarios[0].name).toBe("Refunds case 0");
    });
  });

  describe("given the id names a run plan", () => {
    /** @scenario "Reading a run plan through the test suite route answers suite_not_found" */
    it("answers 404 naming the code", async () => {
      const plan = await createPlan("Nightly");

      const res = await api.get(`${BASE}/${plan.id}`);

      expect(res.status).toBe(404);
      expect((await res.json()).code).toBe("suite_not_found");
    });
  });

  // ── rename ─────────────────────────────────────────────────────────────────

  describe("given a test suite named Refunds", () => {
    /** @scenario "Renaming a test suite keeps its slug" */
    it("takes the new name and keeps the slug", async () => {
      const folder = await createFolder("Refunds");

      const res = await api.patch(`${BASE}/${folder.id}`, { name: "Returns" });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.name).toBe("Returns");
      expect(body.slug).toBe(folder.slug);
    });
  });

  // ── archive ────────────────────────────────────────────────────────────────

  describe("given a test suite holding two scenarios", () => {
    /** @scenario "Archiving a test suite archives the scenarios filed in it" */
    it("archives the suite and every scenario filed in it", async () => {
      const { folder, cases } = await createFolderWithCases("Refunds", 2);

      const res = await api.delete(`${BASE}/${folder.id}`);

      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ id: folder.id, archived: true });

      const storedFolder = await prisma.simulationSuite.findFirst({
        where: { id: folder.id, projectId: testProjectId },
      });
      expect(storedFolder?.archivedAt).not.toBeNull();

      const storedCases = await prisma.scenario.findMany({
        where: {
          id: { in: cases.map((one) => one.id) },
          projectId: testProjectId,
        },
      });
      expect(storedCases).toHaveLength(2);
      for (const scenario of storedCases) {
        expect(scenario.archivedAt).not.toBeNull();
      }
    });
  });

  // ── run ────────────────────────────────────────────────────────────────────

  describe("given a test suite holding one scenario and an agent named dev-agent", () => {
    /** @scenario "Running a test suite names the plan after the suite and its targets" */
    it("creates a run plan named after the suite and the target", async () => {
      const { folder } = await createFolderWithCases("Refunds", 1);
      // A scope that names every folder of the project is the whole project,
      // and normalises to "all" before the name is derived. A second folder
      // keeps this run a folder run, which is what the name reads from.
      await createFolder("Checkout");
      const agent = await createAgent("dev-agent");

      const res = await api.post(`${BASE}/${folder.id}/run`, {
        targets: [{ type: "http", referenceId: agent.id }],
        idempotencyKey: "test-suite-run-1",
      });

      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body).toMatchObject({
        scheduled: true,
        jobCount: 1,
        planName: "Refunds dev-agent",
        created: true,
      });
      expect(queueSimulationRun).toHaveBeenCalledTimes(1);
      expect(startSuiteRun).toHaveBeenCalledWith(
        expect.objectContaining({ batchRunId: body.batchRunId }),
      );
    });

    /** @scenario "Running a test suite twice joins the run plan the first run resolved" */
    it("joins the plan the first run resolved", async () => {
      const { folder } = await createFolderWithCases("Refunds", 1);
      const agent = await createAgent("dev-agent");
      const body = {
        targets: [{ type: "http", referenceId: agent.id }],
      };

      const first = await api.post(`${BASE}/${folder.id}/run`, {
        ...body,
        idempotencyKey: "test-suite-run-2a",
      });
      const second = await api.post(`${BASE}/${folder.id}/run`, {
        ...body,
        idempotencyKey: "test-suite-run-2b",
      });

      expect(second.status).toBe(200);
      const firstBody = await first.json();
      const secondBody = await second.json();
      expect(secondBody.created).toBe(false);
      expect(secondBody.runPlanId).toBe(firstBody.runPlanId);
    });

    /** @scenario "Running a test suite with no target is refused with suite_targets_required" */
    it("answers 422 suite_targets_required for an empty target list", async () => {
      const { folder } = await createFolderWithCases("Refunds", 1);

      const res = await api.post(`${BASE}/${folder.id}/run`, {
        targets: [],
        idempotencyKey: "test-suite-run-3",
      });

      expect(res.status).toBe(422);
      expect((await res.json()).code).toBe("suite_targets_required");
      expect(startSuiteRun).not.toHaveBeenCalled();
      expect(queueSimulationRun).not.toHaveBeenCalled();
    });
  });

  describe("given an id the project does not hold", () => {
    /** @scenario "Running a test suite that does not exist answers suite_not_found" */
    it("answers 404 naming the code", async () => {
      const agent = await createAgent();

      const res = await api.post(`${BASE}/suite_nonexistent/run`, {
        targets: [{ type: "http", referenceId: agent.id }],
      });

      expect(res.status).toBe(404);
      expect((await res.json()).code).toBe("suite_not_found");
    });
  });

  // ── versioning ─────────────────────────────────────────────────────────────

  describe("given the family's version namespaces", () => {
    /** @scenario "A dated test suites path and the bare alias both answer" */
    it("answers the same on the dated path and the bare alias", async () => {
      const folder = await createFolder("Refunds");

      const dated = await api.get(`${BASE}/${V1_API_VERSION}/`);
      const bare = await api.get(BASE);

      expect(dated.status).toBe(200);
      expect(bare.status).toBe(200);
      const datedIds = (await dated.json()).map(
        (one: { id: string }) => one.id,
      );
      const bareIds = (await bare.json()).map((one: { id: string }) => one.id);
      expect(datedIds).toEqual([folder.id]);
      expect(datedIds).toEqual(bareIds);
    });

    /** @scenario "An unknown test suites version segment answers 404" */
    it("answers 404 for a version segment the family never served", async () => {
      const res = await api.get(`${BASE}/2020-01-01/`);

      expect(res.status).toBe(404);
    });
  });
});
