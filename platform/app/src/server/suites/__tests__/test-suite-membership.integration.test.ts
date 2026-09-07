/**
 * @vitest-environment node
 *
 * The test suite membership invariant, walked against a real database:
 * Scenario.testSuiteId is the source of truth, the test suite's scenarioIds is a
 * reconciled copy, and every membership write keeps the two in step inside
 * its own transaction.
 *
 * @see specs/suites/test-suite-membership-invariant.feature
 * @see specs/scenarios/scenario-test-suite-assignment.feature
 */
import { nanoid } from "nanoid";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SuiteRunService } from "~/server/app-layer/suites/suite-run.service";
import { getTestUser } from "../../../utils/testUtils";
import { prisma } from "../../db";
import { ScenarioService } from "../../scenarios/scenario.service";
import { findDefaultSuite } from "../default-suite";
import { SuiteService } from "../suite.service";
import { reconcileTestSuiteMembership } from "../test-suite-membership";

const projectId = `test-suite-membership-${nanoid(8)}`;
const otherProjectId = `${projectId}-other`;

const scenarioService = ScenarioService.create(prisma);
// The run service is never reached by membership writes; a stub keeps the
// test on the datastore path only.
const suiteService = SuiteService.create({
  prisma,
  suiteRunService: {} as SuiteRunService,
});

async function createTestSuite(name: string, project = projectId) {
  return suiteService.createTestSuite({ projectId: project, name });
}

async function createCase({
  name,
  testSuiteId,
  project = projectId,
}: {
  name: string;
  testSuiteId?: string | null;
  project?: string;
}) {
  return scenarioService.create({
    projectId: project,
    name,
    situation: "A customer asks for help",
    criteria: ["The agent helps"],
    labels: [],
    ...(testSuiteId !== undefined && { testSuiteId }),
  });
}

async function testSuiteScenarioIds(testSuiteId: string): Promise<string[]> {
  const testSuite = await prisma.simulationSuite.findFirst({
    where: { id: testSuiteId, projectId },
  });
  return testSuite?.scenarioIds ?? [];
}

/**
 * The invariant itself: every active scenario's testSuiteId agrees with every
 * test suite's scenarioIds, in both directions.
 *
 * Returns one line per disagreement, so each test holds the assertion and a
 * failure names the test suite and the scenarios that broke it.
 */
async function invariantBreaks(): Promise<string[]> {
  const testSuites = await prisma.simulationSuite.findMany({
    where: { projectId, kind: "test_suite", archivedAt: null },
  });
  const activeCases = await prisma.scenario.findMany({
    where: { projectId, archivedAt: null },
    select: { id: true, testSuiteId: true },
  });
  const testSuiteIdByCaseId = new Map(
    activeCases.map((scenario) => [scenario.id, scenario.testSuiteId]),
  );

  const breaks: string[] = [];
  for (const testSuite of testSuites) {
    const namedMembers = activeCases
      .filter((scenario) => scenario.testSuiteId === testSuite.id)
      .map((scenario) => scenario.id)
      .sort();
    const heldMembers = [...testSuite.scenarioIds].sort();
    if (heldMembers.join(",") !== namedMembers.join(",")) {
      breaks.push(
        `test suite ${testSuite.id} holds [${heldMembers.join(", ")}] but the scenarios name [${namedMembers.join(", ")}]`,
      );
    }
    const strangers = heldMembers.filter(
      (caseId) =>
        testSuiteIdByCaseId.has(caseId) &&
        testSuiteIdByCaseId.get(caseId) !== testSuite.id,
    );
    if (strangers.length > 0) {
      breaks.push(
        `test suite ${testSuite.id} holds [${strangers.join(", ")}], which name another test suite`,
      );
    }
  }
  return breaks;
}

beforeAll(async () => {
  await getTestUser();
  const organization = await prisma.organization.findUnique({
    where: { slug: "test-organization" },
  });
  const team = await prisma.team.findFirst({
    where: { slug: "test-team", organizationId: organization!.id },
  });
  for (const id of [projectId, otherProjectId]) {
    await prisma.project.upsert({
      where: { id },
      update: {},
      create: {
        id,
        name: id,
        slug: id,
        apiKey: `sk-lw-${id}`,
        teamId: team!.id,
        language: "en",
        framework: "test",
      },
    });
  }
});

beforeEach(async () => {
  await prisma.scenario.deleteMany({
    where: { projectId: { in: [projectId, otherProjectId] } },
  });
  await prisma.simulationSuite.deleteMany({
    where: { projectId: { in: [projectId, otherProjectId] } },
  });
});

describe("test suite membership", () => {
  describe("when a scenario is created inside a test suite", () => {
    /** @scenario "Creating a scenario inside a test suite puts it on both sides at once" */
    /** @scenario "A scenario created from inside a suite is filed into that suite" */
    it("names the test suite on the scenario and holds the scenario on the test suite", async () => {
      const testSuite = await createTestSuite("Refunds");
      const scenario = await createCase({
        name: "Refund",
        testSuiteId: testSuite.id,
      });

      expect(scenario.testSuiteId).toBe(testSuite.id);
      expect(await testSuiteScenarioIds(testSuite.id)).toEqual([scenario.id]);
      expect(await invariantBreaks()).toEqual([]);
    });

    /** @scenario "A scenario created without naming a test suite is filed into Default" */
    /** @scenario "A scenario created with no suite is filed into Default" */
    it("files a scenario created without a test suite into Default", async () => {
      const scenario = await createCase({ name: "Unfiled" });

      const defaultSuite = await findDefaultSuite({ projectId, prisma });
      expect(defaultSuite).not.toBeNull();
      expect(scenario.testSuiteId).toBe(defaultSuite?.id);
      expect(await testSuiteScenarioIds(defaultSuite!.id)).toEqual([
        scenario.id,
      ]);
      expect(await invariantBreaks()).toEqual([]);
    });

    /** @scenario "A second scenario created with no suite reuses the same Default" */
    it("reuses one Default suite for every scenario created without a test suite", async () => {
      const first = await createCase({ name: "First" });
      const second = await createCase({ name: "Second" });

      expect(second.testSuiteId).toBe(first.testSuiteId);
      const defaults = await prisma.simulationSuite.findMany({
        where: {
          projectId,
          kind: "test_suite",
          name: "Default",
          archivedAt: null,
        },
      });
      expect(defaults).toHaveLength(1);
      expect(await testSuiteScenarioIds(first.testSuiteId!)).toEqual([
        first.id,
        second.id,
      ]);
    });

    /** @scenario "A scenario created with a suite named is filed there, not in Default" */
    it("creates no Default suite when the scenario names a test suite", async () => {
      const refunds = await createTestSuite("Refunds");
      const scenario = await createCase({
        name: "Refund",
        testSuiteId: refunds.id,
      });

      expect(scenario.testSuiteId).toBe(refunds.id);
      expect(await findDefaultSuite({ projectId, prisma })).toBeNull();
    });

    /** @scenario "Two scenarios created at the same time share one Default suite" */
    it("shares one Default suite between two concurrent creates", async () => {
      const [first, second] = await Promise.all([
        createCase({ name: "First" }),
        createCase({ name: "Second" }),
      ]);

      const defaults = await prisma.simulationSuite.findMany({
        where: {
          projectId,
          kind: "test_suite",
          name: "Default",
          archivedAt: null,
        },
      });
      expect(defaults).toHaveLength(1);
      expect(first.testSuiteId).toBe(defaults[0]!.id);
      expect(second.testSuiteId).toBe(defaults[0]!.id);
      expect(await invariantBreaks()).toEqual([]);
    });

    /** @scenario "A Default suite created while another suite already owns the slug takes a numbered slug" */
    it("takes a numbered slug when another suite already owns 'default'", async () => {
      await suiteService.create({
        projectId,
        name: "Default",
        kind: "run_plan",
        scenarioIds: [],
        targets: [],
        repeatCount: 1,
        labels: [],
      });

      const scenario = await createCase({ name: "Unfiled" });

      const defaultSuite = await prisma.simulationSuite.findFirst({
        where: { id: scenario.testSuiteId!, projectId },
      });
      expect(defaultSuite?.kind).toBe("test_suite");
      expect(defaultSuite?.name).toBe("Default");
      expect(defaultSuite?.slug).not.toBe("default");
    });
  });

  describe("when a scenario moves between test suites", () => {
    /** @scenario "Moving a scenario between test suites updates both test suites" */
    it("updates both test suites in one write", async () => {
      const refunds = await createTestSuite("Refunds");
      const checkout = await createTestSuite("Checkout");
      const scenario = await createCase({
        name: "Refund",
        testSuiteId: refunds.id,
      });

      const moved = await scenarioService.moveToTestSuite({
        scenarioId: scenario.id,
        projectId,
        testSuiteId: checkout.id,
      });

      expect(moved.testSuiteId).toBe(checkout.id);
      expect(await testSuiteScenarioIds(checkout.id)).toEqual([scenario.id]);
      expect(await testSuiteScenarioIds(refunds.id)).toEqual([]);
      expect(await invariantBreaks()).toEqual([]);
    });

    /** @scenario "Filing a scenario out of Default updates both suites" */
    it("moves a scenario out of Default and updates both suites", async () => {
      const stays = await createCase({ name: "Stays" });
      const moves = await createCase({ name: "Moves" });
      const defaultSuite = await findDefaultSuite({ projectId, prisma });
      expect(await testSuiteScenarioIds(defaultSuite!.id)).toEqual([
        stays.id,
        moves.id,
      ]);
      const refunds = await createTestSuite("Refunds");

      await scenarioService.moveToTestSuite({
        scenarioId: moves.id,
        projectId,
        testSuiteId: refunds.id,
      });

      expect(await testSuiteScenarioIds(defaultSuite!.id)).toEqual([stays.id]);
      expect(await testSuiteScenarioIds(refunds.id)).toEqual([moves.id]);
      expect(await invariantBreaks()).toEqual([]);
    });

    /** @scenario "Taking a scenario out of its test suite files it into Default" */
    /** @scenario "Removing a scenario from its suite files it into Default instead of leaving it loose" */
    it("files a scenario into Default when it is taken out of its test suite", async () => {
      const refunds = await createTestSuite("Refunds");
      const scenario = await createCase({
        name: "Refund",
        testSuiteId: refunds.id,
      });

      const moved = await scenarioService.moveToTestSuite({
        scenarioId: scenario.id,
        projectId,
        testSuiteId: null,
      });

      const defaultSuite = await findDefaultSuite({ projectId, prisma });
      expect(defaultSuite).not.toBeNull();
      expect(moved.testSuiteId).toBe(defaultSuite?.id);
      expect(await testSuiteScenarioIds(refunds.id)).toEqual([]);
      expect(await testSuiteScenarioIds(defaultSuite!.id)).toEqual([
        scenario.id,
      ]);
      const listed = await scenarioService.getAll({ projectId });
      expect(listed.map((s) => s.id)).toContain(scenario.id);
      expect(await invariantBreaks()).toEqual([]);
    });

    /** @scenario "A move that fails leaves both sides untouched" */
    /** @scenario "A refused move leaves the scenario in the test suite it was in" */
    it("leaves both sides untouched when the destination is refused", async () => {
      const refunds = await createTestSuite("Refunds");
      const archived = await createTestSuite("Old");
      await suiteService.archiveTestSuite({
        projectId,
        testSuiteId: archived.id,
      });
      const scenario = await createCase({
        name: "Refund",
        testSuiteId: refunds.id,
      });

      await expect(
        scenarioService.moveToTestSuite({
          scenarioId: scenario.id,
          projectId,
          testSuiteId: archived.id,
        }),
      ).rejects.toMatchObject({ code: "scenario_test_suite_not_found" });

      const kept = await prisma.scenario.findFirst({
        where: { id: scenario.id, projectId },
      });
      expect(kept?.testSuiteId).toBe(refunds.id);
      expect(await testSuiteScenarioIds(refunds.id)).toEqual([scenario.id]);
      expect(await invariantBreaks()).toEqual([]);
    });

    /** @scenario "A scenario cannot be filed into a run plan that is not a test suite" */
    it("refuses to file a scenario into a run plan", async () => {
      const refunds = await createTestSuite("Refunds");
      const scenario = await createCase({
        name: "Refund",
        testSuiteId: refunds.id,
      });
      const plan = await prisma.simulationSuite.create({
        data: {
          id: `suite_${nanoid()}`,
          projectId,
          name: "Nightly",
          slug: `nightly-${nanoid(6)}`,
          scenarioIds: [scenario.id],
          targets: [{ type: "http", referenceId: "agent_1" }],
          labels: [],
        },
      });

      await expect(
        scenarioService.moveToTestSuite({
          scenarioId: scenario.id,
          projectId,
          testSuiteId: plan.id,
        }),
      ).rejects.toMatchObject({ code: "scenario_test_suite_not_found" });

      const kept = await prisma.scenario.findFirst({
        where: { id: scenario.id, projectId },
      });
      expect(kept?.testSuiteId).toBe(refunds.id);
    });

    /** @scenario "Filing a scenario into a suite of another project is refused with scenario_test_suite_not_found" */
    it("refuses a test suite that belongs to another project", async () => {
      const foreign = await createTestSuite("Foreign", otherProjectId);
      const refunds = await createTestSuite("Refunds");
      const scenario = await createCase({
        name: "Refund",
        testSuiteId: refunds.id,
      });

      await expect(
        scenarioService.moveToTestSuite({
          scenarioId: scenario.id,
          projectId,
          testSuiteId: foreign.id,
        }),
      ).rejects.toMatchObject({ code: "scenario_test_suite_not_found" });

      const kept = await prisma.scenario.findFirst({
        where: { id: scenario.id, projectId },
      });
      expect(kept?.testSuiteId).toBe(refunds.id);
    });
  });

  describe("when scenarios are archived", () => {
    /** @scenario "Archiving one scenario drops it from its test suite" */
    it("drops the archived scenario from the test suite and keeps the rest", async () => {
      const refunds = await createTestSuite("Refunds");
      const first = await createCase({ name: "One", testSuiteId: refunds.id });
      const second = await createCase({ name: "Two", testSuiteId: refunds.id });

      await scenarioService.archive({ id: first.id, projectId });

      expect(await testSuiteScenarioIds(refunds.id)).toEqual([second.id]);
      expect(await invariantBreaks()).toEqual([]);
    });

    /** @scenario "Archiving many scenarios at once drops all of them from their test suites" */
    it("recomputes the test suite once for a batch archive", async () => {
      const refunds = await createTestSuite("Refunds");
      const cases = [];
      for (const name of ["One", "Two", "Three", "Four"]) {
        cases.push(await createCase({ name, testSuiteId: refunds.id }));
      }

      const result = await scenarioService.batchArchive({
        ids: cases.slice(0, 3).map((scenario) => scenario.id),
        projectId,
      });

      expect(result.archived).toHaveLength(3);
      expect(result.failed).toHaveLength(0);
      expect(await testSuiteScenarioIds(refunds.id)).toEqual([cases[3]!.id]);
      expect(await invariantBreaks()).toEqual([]);
    });

    /** @scenario "Restoring an archived scenario puts it back in its test suite" */
    it("puts a restored scenario back through the reconcile", async () => {
      const refunds = await createTestSuite("Refunds");
      const scenario = await createCase({
        name: "Refund",
        testSuiteId: refunds.id,
      });
      await scenarioService.archive({ id: scenario.id, projectId });
      expect(await testSuiteScenarioIds(refunds.id)).toEqual([]);

      // The restore path clears archivedAt and reconciles, exactly like every
      // other membership write.
      await prisma.$transaction(async (tx) => {
        await tx.scenario.update({
          where: { id: scenario.id, projectId },
          data: { archivedAt: null },
        });
        await reconcileTestSuiteMembership({
          projectId,
          testSuiteId: refunds.id,
          tx,
        });
      });

      expect(await testSuiteScenarioIds(refunds.id)).toEqual([scenario.id]);
      expect(await invariantBreaks()).toEqual([]);
    });
  });

  describe("when a test suite is archived", () => {
    /** @scenario "An archived test suite keeps the membership it had" */
    it("keeps the final member list as a snapshot and archives the scenarios", async () => {
      const refunds = await createTestSuite("Refunds");
      const scenarioIds = [];
      for (const name of ["One", "Two", "Three"]) {
        const scenario = await createCase({ name, testSuiteId: refunds.id });
        scenarioIds.push(scenario.id);
      }

      await suiteService.archiveTestSuite({
        projectId,
        testSuiteId: refunds.id,
      });

      const archivedTestSuite = await prisma.simulationSuite.findFirst({
        where: { id: refunds.id, projectId },
      });
      expect(archivedTestSuite?.archivedAt).not.toBeNull();
      expect([...(archivedTestSuite?.scenarioIds ?? [])].sort()).toEqual(
        [...scenarioIds].sort(),
      );
      const archivedCases = await prisma.scenario.findMany({
        where: { id: { in: scenarioIds }, projectId },
      });
      expect(archivedCases).toHaveLength(3);
      for (const archivedCase of archivedCases) {
        expect(archivedCase.archivedAt).not.toBeNull();
        expect(archivedCase.testSuiteId).toBe(refunds.id);
      }
    });
  });

  describe("when a duplicate is made", () => {
    /** @scenario "Duplicating a scenario copies its suite" */
    it("files the copy in the same test suite with the same definition", async () => {
      const refunds = await createTestSuite("Refunds");
      const scenario = await scenarioService.create({
        projectId,
        name: "Refund",
        situation: "A {{ params.tier }} customer wants a refund",
        criteria: ["The agent refunds"],
        labels: ["billing"],
        parameters: [{ name: "tier", defaultValue: "gold" }],
        testSuiteId: refunds.id,
      });

      const copy = await scenarioService.duplicate({
        scenarioId: scenario.id,
        projectId,
      });

      expect(copy.id).not.toBe(scenario.id);
      expect(copy.name).toBe("Refund (copy)");
      expect(copy.testSuiteId).toBe(refunds.id);
      expect(copy.situation).toBe(scenario.situation);
      expect(copy.criteria).toEqual(scenario.criteria);
      expect(copy.labels).toEqual(scenario.labels);
      expect(copy.parameters).toEqual(scenario.parameters);
      expect(await testSuiteScenarioIds(refunds.id)).toEqual([
        scenario.id,
        copy.id,
      ]);
      expect(await invariantBreaks()).toEqual([]);
    });
  });

  describe("when scenarios are created, moved, archived and batch-archived in turn", () => {
    /** @scenario "The two sides agree after a full create, move, archive and batch-archive walk" */
    it("holds the invariant after every step", async () => {
      const refunds = await createTestSuite("Refunds");
      const checkout = await createTestSuite("Checkout");

      const cases = [];
      for (let i = 0; i < 5; i++) {
        cases.push(
          await createCase({
            name: `Scenario ${i}`,
            testSuiteId: i < 3 ? refunds.id : checkout.id,
          }),
        );
      }
      expect(await invariantBreaks()).toEqual([]);

      await scenarioService.moveToTestSuite({
        scenarioId: cases[0]!.id,
        projectId,
        testSuiteId: checkout.id,
      });
      expect(await invariantBreaks()).toEqual([]);

      await scenarioService.archive({ id: cases[3]!.id, projectId });
      expect(await invariantBreaks()).toEqual([]);

      await scenarioService.batchArchive({
        ids: [cases[1]!.id, cases[4]!.id],
        projectId,
      });
      expect(await invariantBreaks()).toEqual([]);

      expect(await testSuiteScenarioIds(refunds.id)).toEqual([cases[2]!.id]);
      expect(await testSuiteScenarioIds(checkout.id)).toEqual([cases[0]!.id]);
    });
  });

  describe("when two scenarios are filed into one test suite at the same time", () => {
    /** @scenario "Two scenarios filed into one test suite at the same time both land in it" */
    it("holds both of them", async () => {
      const refunds = await createTestSuite("Refunds");
      const first = await createCase({ name: "First" });
      const second = await createCase({ name: "Second" });

      // Both moves run at once on purpose. The reconcile reads the member
      // list to decide what to write, so without the test suite's row lock the
      // one that commits second writes a list that never held the other's
      // scenario.
      await Promise.all([
        scenarioService.moveToTestSuite({
          scenarioId: first.id,
          projectId,
          testSuiteId: refunds.id,
        }),
        scenarioService.moveToTestSuite({
          scenarioId: second.id,
          projectId,
          testSuiteId: refunds.id,
        }),
      ]);

      expect(new Set(await testSuiteScenarioIds(refunds.id))).toEqual(
        new Set([first.id, second.id]),
      );
      expect(await invariantBreaks()).toEqual([]);
    });
  });
});
