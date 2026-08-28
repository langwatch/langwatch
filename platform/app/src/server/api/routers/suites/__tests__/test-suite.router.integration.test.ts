/**
 * @vitest-environment node
 *
 * The suites.test suites tRPC surface and the v1 kind guard, against a real
 * database with real RBAC role bindings.
 *
 * @see specs/suites/test-suites.feature
 * @see specs/suites/test-suite-run-plan-reuse.feature
 * @see specs/scenarios/scenario-test-suite-assignment.feature
 */
import { nanoid } from "nanoid";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { OrganizationUserRole, TeamUserRole } from "~/generated/prisma/client";
import { cleanupTestRows } from "~/test-utils/cleanupTestRows";
import { wireDefaultTestApp } from "~/test-utils/wireDefaultTestApp";
import { prisma } from "../../../../db";
import { appRouter } from "../../../root";
import { createInnerTRPCContext } from "../../../trpc";

wireDefaultTestApp();

describe("suites.test suites integration", () => {
  const ns = `testSuite-router-${nanoid(8)}`;
  let projectId: string;
  let otherProjectId: string;
  let caller: ReturnType<typeof appRouter.createCaller>;
  let viewerCaller: ReturnType<typeof appRouter.createCaller>;
  let organizationId: string;
  let teamId: string;
  const userIds: string[] = [];

  beforeAll(async () => {
    const organization = await prisma.organization.create({
      data: { name: "Test suite Org", slug: `--test-org-${ns}` },
    });
    organizationId = organization.id;
    const team = await prisma.team.create({
      data: {
        name: "Test suite Team",
        slug: `--test-team-${ns}`,
        organizationId: organization.id,
      },
    });
    teamId = team.id;
    const project = await prisma.project.create({
      data: {
        name: "Test suite Project",
        slug: `--test-project-${ns}`,
        apiKey: `sk-lw-test-${nanoid()}`,
        teamId: team.id,
        language: "en",
        framework: "test",
      },
    });
    projectId = project.id;
    const otherProject = await prisma.project.create({
      data: {
        name: "Other Project",
        slug: `--test-project-b-${ns}`,
        apiKey: `sk-lw-test-${nanoid()}`,
        teamId: team.id,
        language: "en",
        framework: "test",
      },
    });
    otherProjectId = otherProject.id;

    const admin = await prisma.user.create({
      data: { name: "Admin", email: `admin-${ns}@example.com` },
    });
    userIds.push(admin.id);
    await prisma.organizationUser.create({
      data: {
        userId: admin.id,
        organizationId: organization.id,
        role: OrganizationUserRole.ADMIN,
      },
    });
    await prisma.teamUser.create({
      data: { userId: admin.id, teamId: team.id, role: TeamUserRole.ADMIN },
    });
    caller = appRouter.createCaller(
      createInnerTRPCContext({
        session: { user: { id: admin.id }, expires: "1" },
      }),
    );

    const viewer = await prisma.user.create({
      data: { name: "Viewer", email: `viewer-${ns}@example.com` },
    });
    userIds.push(viewer.id);
    await prisma.organizationUser.create({
      data: {
        userId: viewer.id,
        organizationId: organization.id,
        role: OrganizationUserRole.MEMBER,
      },
    });
    await prisma.teamUser.create({
      data: { userId: viewer.id, teamId: team.id, role: TeamUserRole.VIEWER },
    });
    viewerCaller = appRouter.createCaller(
      createInnerTRPCContext({
        session: { user: { id: viewer.id }, expires: "1" },
      }),
    );
  });

  // Creating a scenario writes its first version, and ScenarioVersion has no
  // foreign key, so those rows outlive the scenario unless they go first.
  beforeEach(() =>
    cleanupTestRows(prisma, [
      ["scenarioVersion", { projectId: { in: [projectId, otherProjectId] } }],
      ["scenario", { projectId: { in: [projectId, otherProjectId] } }],
      ["simulationSuite", { projectId: { in: [projectId, otherProjectId] } }],
    ]),
  );

  afterAll(() =>
    cleanupTestRows(prisma, [
      ["scenarioVersion", { projectId: { in: [projectId, otherProjectId] } }],
      ["scenario", { projectId: { in: [projectId, otherProjectId] } }],
      ["simulationSuite", { projectId: { in: [projectId, otherProjectId] } }],
      ["project", { id: { in: [projectId, otherProjectId] } }],
      ["teamUser", { teamId }],
      ["organizationUser", { organizationId }],
      ["team", { id: teamId }],
      ["user", { id: { in: userIds } }],
      ["organization", { id: organizationId }],
    ]),
  );

  async function createCustomPlan(name: string, project = projectId) {
    const scenario = await prisma.scenario.create({
      data: {
        projectId: project,
        name: `${name} scenario`,
        situation: "A customer asks for help",
        criteria: ["The agent helps"],
        labels: [],
      },
    });
    return prisma.simulationSuite.create({
      data: {
        id: `suite_${nanoid()}`,
        projectId: project,
        name,
        slug: `${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}-${nanoid(6)}`,
        scenarioIds: [scenario.id],
        targets: [{ type: "http", referenceId: "agent_1" }],
        labels: [],
      },
    });
  }

  describe("creating a test suite", () => {
    /** @scenario "A new test suite is created empty and appears in the rail" */
    it("creates it empty and lists it in test suites.getAll", async () => {
      const testSuite = await caller.suites.testSuites.create({
        projectId,
        name: "Refunds",
      });

      expect(testSuite.kind).toBe("test_suite");
      expect(testSuite.scenarioIds).toEqual([]);

      const testSuites = await caller.suites.testSuites.getAll({ projectId });
      expect(testSuites.map((f) => f.id)).toContain(testSuite.id);
      expect(
        testSuites.find((f) => f.id === testSuite.id)?.scenarioIds,
      ).toEqual([]);
    });

    /** @scenario "A test suite created with a name another suite already uses keeps both names readable" */
    it("keeps the name readable and takes a different address when a run plan holds the slug", async () => {
      const plan = await prisma.simulationSuite.create({
        data: {
          id: `suite_${nanoid()}`,
          projectId,
          name: "Refunds",
          slug: "refunds",
          scenarioIds: ["scen_x"],
          targets: [{ type: "http", referenceId: "agent_1" }],
          labels: [],
        },
      });

      const testSuite = await caller.suites.testSuites.create({
        projectId,
        name: "Refunds",
      });

      expect(testSuite.name).toBe("Refunds");
      expect(testSuite.slug).not.toBe(plan.slug);
      expect(testSuite.slug).toMatch(/^refunds-/);
    });
  });

  describe("renaming a test suite", () => {
    /** @scenario "Renaming a test suite keeps its scenarios and its run history" */
    it("changes the name and keeps the slug and the member list", async () => {
      const testSuite = await caller.suites.testSuites.create({
        projectId,
        name: "Refunds",
      });
      const scenario = await caller.scenarios.create({
        projectId,
        name: "Refund scenario",
        situation: "A customer wants a refund",
        criteria: [],
        labels: [],
        testSuiteId: testSuite.id,
      });

      const renamed = await caller.suites.testSuites.rename({
        projectId,
        testSuiteId: testSuite.id,
        name: "Refunds and credits",
      });

      expect(renamed.name).toBe("Refunds and credits");
      // The slug addresses the test suite's run history, so a rename keeps it.
      expect(renamed.slug).toBe(testSuite.slug);
      expect(renamed.scenarioIds).toEqual([scenario.id]);
    });

    /** @scenario "Renaming a test suite in another project is refused with suite_not_found" */
    it("refuses a test suite of another project with suite_not_found", async () => {
      const foreign = await prisma.simulationSuite.create({
        data: {
          id: `suite_${nanoid()}`,
          projectId: otherProjectId,
          name: "Foreign",
          slug: `foreign-${nanoid(6)}`,
          kind: "test_suite",
          scenarioIds: [],
          targets: [],
          labels: [],
        },
      });

      await expect(
        caller.suites.testSuites.rename({
          projectId,
          testSuiteId: foreign.id,
          name: "Taken over",
        }),
      ).rejects.toMatchObject({
        cause: expect.objectContaining({ code: "suite_not_found" }),
      });

      const kept = await prisma.simulationSuite.findFirst({
        where: { id: foreign.id, projectId: otherProjectId },
      });
      expect(kept?.name).toBe("Foreign");
    });
  });

  describe("archiving a test suite", () => {
    /** @scenario "Archiving a test suite archives the scenarios in it" */
    /** @scenario "Archiving a test suite archives its run plan too" */
    it("archives the test suite and its scenarios together", async () => {
      const testSuite = await caller.suites.testSuites.create({
        projectId,
        name: "Refunds",
      });
      const first = await caller.scenarios.create({
        projectId,
        name: "One",
        situation: "s",
        criteria: [],
        labels: [],
        testSuiteId: testSuite.id,
      });
      const second = await caller.scenarios.create({
        projectId,
        name: "Two",
        situation: "s",
        criteria: [],
        labels: [],
        testSuiteId: testSuite.id,
      });

      await caller.suites.testSuites.archive({
        projectId,
        testSuiteId: testSuite.id,
      });

      const testSuites = await caller.suites.testSuites.getAll({ projectId });
      expect(testSuites.map((f) => f.id)).not.toContain(testSuite.id);

      const cases = await caller.scenarios.getAll({ projectId });
      const listedIds = cases.map((scenario) => scenario.id);
      expect(listedIds).not.toContain(first.id);
      expect(listedIds).not.toContain(second.id);

      // The test suite's own suite row is archived too, so no run plan surface
      // lists it any more.
      const archivedRow = await prisma.simulationSuite.findFirst({
        where: { id: testSuite.id, projectId },
      });
      expect(archivedRow?.archivedAt).not.toBeNull();
    });

    /** @scenario "Archiving a test suite that is already archived changes nothing" */
    it("keeps the first archive time on a second archive", async () => {
      const testSuite = await caller.suites.testSuites.create({
        projectId,
        name: "Refunds",
      });
      await caller.suites.testSuites.archive({
        projectId,
        testSuiteId: testSuite.id,
      });
      const firstArchive = await prisma.simulationSuite.findFirst({
        where: { id: testSuite.id, projectId },
      });

      await caller.suites.testSuites.archive({
        projectId,
        testSuiteId: testSuite.id,
      });

      const secondArchive = await prisma.simulationSuite.findFirst({
        where: { id: testSuite.id, projectId },
      });
      expect(secondArchive?.archivedAt).toEqual(firstArchive?.archivedAt);
    });
  });

  describe("test suite execution settings", () => {
    /** @scenario "Updating a test suite with execution settings is refused with validation_error" */
    it("refuses targets, a repeat count and models on a test suite", async () => {
      const testSuite = await caller.suites.testSuites.create({
        projectId,
        name: "Refunds",
      });

      await expect(
        caller.suites.update({
          projectId,
          id: testSuite.id,
          targets: [{ type: "http", referenceId: "agent_prod" }],
          repeatCount: 3,
          simulatorModel: "openai/gpt-5-mini",
        }),
      ).rejects.toMatchObject({
        cause: expect.objectContaining({ code: "validation_error" }),
      });

      const kept = await prisma.simulationSuite.findFirst({
        where: { id: testSuite.id, projectId },
      });
      expect(kept?.targets).toEqual([]);
      expect(kept?.repeatCount).toBe(1);
      expect(kept?.simulatorModel).toBeNull();
    });

    it("still saves a name and labels on a test suite", async () => {
      const testSuite = await caller.suites.testSuites.create({
        projectId,
        name: "Refunds",
      });

      await caller.suites.update({
        projectId,
        id: testSuite.id,
        labels: ["priority"],
      });

      const kept = await prisma.simulationSuite.findFirst({
        where: { id: testSuite.id, projectId },
      });
      expect(kept?.labels).toEqual(["priority"]);
    });

    it("refuses a direct scenarioIds write on a test suite", async () => {
      const testSuite = await caller.suites.testSuites.create({
        projectId,
        name: "Refunds",
      });

      await expect(
        caller.suites.update({
          projectId,
          id: testSuite.id,
          scenarioIds: ["scen_forged"],
        }),
      ).rejects.toMatchObject({
        cause: expect.objectContaining({ code: "validation_error" }),
      });

      const kept = await prisma.simulationSuite.findFirst({
        where: { id: testSuite.id, projectId },
      });
      expect(kept?.scenarioIds).toEqual([]);
    });
  });

  describe("the v1 kind guard", () => {
    /** @scenario "The v1 run plan list holds no test suite rows" */
    it("keeps test suite rows out of suites.getAll when no kind is named", async () => {
      await caller.suites.testSuites.create({ projectId, name: "Refunds" });
      await caller.suites.testSuites.create({ projectId, name: "Checkout" });
      const plan = await createCustomPlan("Nightly");

      const listed = await caller.suites.getAll({ projectId });

      expect(listed.map((suite) => suite.id)).toEqual([plan.id]);
    });

    /** @scenario "The v2 Test Runs list holds run plans only" */
    it("lists custom plans for Test Runs and test suites for the suites rail", async () => {
      const refunds = await caller.suites.testSuites.create({
        projectId,
        name: "Refunds",
      });
      const checkout = await caller.suites.testSuites.create({
        projectId,
        name: "Checkout",
      });
      const plan = await createCustomPlan("Nightly");

      const testRuns = await caller.suites.getAll({
        projectId,
        kinds: ["run_plan"],
      });
      expect(testRuns.map((suite) => suite.id)).toEqual([plan.id]);

      const suites = await caller.suites.testSuites.getAll({ projectId });
      expect(suites.map((suite) => suite.id).sort()).toEqual(
        [refunds.id, checkout.id].sort(),
      );
    });
  });

  describe("permissions", () => {
    /** @scenario "A viewer can read test suites but cannot create or archive one" */
    it("lets a viewer read test suites and refuses their writes", async () => {
      const testSuite = await caller.suites.testSuites.create({
        projectId,
        name: "Refunds",
      });

      const seen = await viewerCaller.suites.testSuites.getAll({ projectId });
      expect(seen.map((f) => f.id)).toContain(testSuite.id);

      await expect(
        viewerCaller.suites.testSuites.create({ projectId, name: "Mine" }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
      await expect(
        viewerCaller.suites.testSuites.archive({
          projectId,
          testSuiteId: testSuite.id,
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });
    });

    /** @scenario "A person with read-only access cannot move a scenario" */
    it("refuses a viewer's move of a scenario", async () => {
      const testSuite = await caller.suites.testSuites.create({
        projectId,
        name: "Refunds",
      });
      const scenario = await caller.scenarios.create({
        projectId,
        name: "Refund scenario",
        situation: "s",
        criteria: [],
        labels: [],
      });

      await expect(
        viewerCaller.scenarios.moveToTestSuite({
          projectId,
          scenarioId: scenario.id,
          testSuiteId: testSuite.id,
        }),
      ).rejects.toMatchObject({ code: "FORBIDDEN" });

      const kept = await prisma.scenario.findFirst({
        where: { id: scenario.id, projectId },
      });
      expect(kept?.testSuiteId).toBe(scenario.testSuiteId);
    });
  });

  describe("moving a scenario over tRPC", () => {
    /** @scenario "Moving a scenario from its row menu regroups the scenario list" */
    /** @scenario "Taking a scenario out of its suite moves it to Default" */
    it("moves a scenario between suites and back to Default, keeping its id and history key", async () => {
      const refunds = await caller.suites.testSuites.create({
        projectId,
        name: "Refunds",
      });
      const checkout = await caller.suites.testSuites.create({
        projectId,
        name: "Checkout",
      });
      const scenario = await caller.scenarios.create({
        projectId,
        name: "Refund scenario",
        situation: "s",
        criteria: [],
        labels: [],
        testSuiteId: refunds.id,
      });

      const moved = await caller.scenarios.moveToTestSuite({
        projectId,
        scenarioId: scenario.id,
        testSuiteId: checkout.id,
      });
      // Run history keys on the scenario id, which the move never touches.
      expect(moved.id).toBe(scenario.id);
      expect(moved.testSuiteId).toBe(checkout.id);

      const takenOut = await caller.scenarios.moveToTestSuite({
        projectId,
        scenarioId: scenario.id,
        testSuiteId: null,
      });
      const defaultSuite = await prisma.simulationSuite.findFirst({
        where: {
          projectId,
          kind: "test_suite",
          name: "Default",
          archivedAt: null,
        },
      });
      expect(takenOut.testSuiteId).toBe(defaultSuite?.id);

      const listed = await caller.scenarios.getAll({ projectId });
      expect(listed.map((s) => s.id)).toContain(scenario.id);
    });
  });
});
