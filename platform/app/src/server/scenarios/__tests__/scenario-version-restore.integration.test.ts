/**
 * @vitest-environment node
 *
 * Restoring an older scenario version against a real database. Restore is
 * append-only: it reads an old snapshot and saves it forward as a new
 * version, so history is never rewritten and a restore can itself be undone.
 *
 * @see specs/scenarios/scenario-version-restore.feature
 */
import { nanoid } from "nanoid";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SuiteRunService } from "~/server/app-layer/suites/suite-run.service";
import { getTestUser } from "../../../utils/testUtils";
import { prisma } from "../../db";
import { SuiteService } from "../../suites/suite.service";
import { ScenarioVersionNotFoundError } from "../errors";
import { ScenarioService } from "../scenario.service";
import type { ScenarioActor } from "../scenario-versioning";

const projectId = `test-scenario-restore-${nanoid(8)}`;
const otherProjectId = `${projectId}-other`;

const service = ScenarioService.create(prisma);
// Test suite creation never reaches the run service; a stub keeps the test on
// the datastore path only.
const suiteService = SuiteService.create({
  prisma,
  suiteRunService: {} as SuiteRunService,
});

const apiActor: ScenarioActor = { userId: null, label: "api" };

/** A scenario whose situation moved through five saves, one per version. */
async function createCaseAtVersionFive() {
  const scenario = await service.create(
    {
      projectId,
      name: "Refund flow",
      situation: "situation v1",
      criteria: ["The agent helps"],
      labels: [],
    },
    { actor: apiActor },
  );
  for (const version of [2, 3, 4, 5]) {
    await service.update({
      id: scenario.id,
      projectId,
      data: {
        situation: `situation v${version}`,
      },
    });
  }
  return scenario;
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
  await prisma.scenarioVersion.deleteMany({
    where: { projectId: { in: [projectId, otherProjectId] } },
  });
  await prisma.scenario.deleteMany({
    where: { projectId: { in: [projectId, otherProjectId] } },
  });
  await prisma.simulationSuite.deleteMany({
    where: { projectId: { in: [projectId, otherProjectId] } },
  });
});

describe("restoring a scenario version", () => {
  /** @scenario "Restoring an older version writes a new version at the top" */
  it("writes a new version holding the older content and rewrites nothing", async () => {
    const scenario = await createCaseAtVersionFive();

    await service.restoreVersion({
      projectId,
      scenarioId: scenario.id,
      version: 2,
      actor: apiActor,
    });

    const stored = await service.getById({ id: scenario.id, projectId });
    expect(stored?.version).toBe(6);
    expect(stored?.situation).toBe("situation v2");

    const versionFive = await prisma.scenarioVersion.findFirst({
      where: { projectId, scenarioId: scenario.id, version: 5 },
    });
    expect(versionFive).not.toBeNull();
    const detailFive = await service.getVersion({
      projectId,
      scenarioId: scenario.id,
      version: 5,
    });
    expect(detailFive.fields.situation).toBe("situation v5");
  });

  /** @scenario "The restore entry says which version it came from" */
  it("names the restored version and the person who restored it", async () => {
    const user = await getTestUser();
    const scenario = await createCaseAtVersionFive();

    await service.restoreVersion({
      projectId,
      scenarioId: scenario.id,
      version: 2,
      actor: { userId: user.id, label: "user" },
    });

    const { versions } = await service.listVersions({
      projectId,
      scenarioId: scenario.id,
    });
    expect(versions[0]).toMatchObject({
      version: 6,
      changeDescription: "Restored from v2",
      authorId: user.id,
      authorLabel: "user",
    });
  });

  /** @scenario "A restore can be undone by restoring the version before it" */
  it("can be undone by restoring the version before it", async () => {
    const scenario = await createCaseAtVersionFive();
    await service.restoreVersion({
      projectId,
      scenarioId: scenario.id,
      version: 2,
      actor: apiActor,
    });

    await service.restoreVersion({
      projectId,
      scenarioId: scenario.id,
      version: 5,
      actor: apiActor,
    });

    const stored = await service.getById({ id: scenario.id, projectId });
    expect(stored?.version).toBe(7);
    expect(stored?.situation).toBe("situation v5");
  });

  /** @scenario "Restoring the newest version still writes an entry" */
  it("writes an entry even when the newest version is restored", async () => {
    const scenario = await createCaseAtVersionFive();

    await service.restoreVersion({
      projectId,
      scenarioId: scenario.id,
      version: 5,
      actor: apiActor,
    });

    const stored = await service.getById({ id: scenario.id, projectId });
    expect(stored?.version).toBe(6);
    expect(stored?.situation).toBe("situation v5");

    const { versions } = await service.listVersions({
      projectId,
      scenarioId: scenario.id,
    });
    expect(versions[0]).toMatchObject({
      version: 6,
      changeDescription: "Restored from v5",
      changedFields: [],
    });
  });

  it("leaves the test suite of the scenario unchanged", async () => {
    const testSuite = await suiteService.createTestSuite({
      projectId,
      name: "Refunds",
    });
    const scenario = await service.create(
      {
        projectId,
        name: "Filed scenario",
        situation: "situation v1",
        criteria: ["The agent helps"],
        labels: [],
        testSuiteId: testSuite.id,
      },
      { actor: apiActor },
    );
    await service.update({
      id: scenario.id,
      projectId,
      data: { situation: "situation v2" },
    });

    await service.restoreVersion({
      projectId,
      scenarioId: scenario.id,
      version: 1,
      actor: apiActor,
    });

    const stored = await service.getById({ id: scenario.id, projectId });
    expect(stored?.situation).toBe("situation v1");
    expect(stored?.testSuiteId).toBe(testSuite.id);
  });

  describe("failure paths", () => {
    /** @scenario "Restoring a version that does not exist is refused with scenario_version_not_found" */
    it("refuses an unknown version and leaves the scenario unchanged", async () => {
      const scenario = await createCaseAtVersionFive();

      await expect(
        service.restoreVersion({
          projectId,
          scenarioId: scenario.id,
          version: 9,
          actor: apiActor,
        }),
      ).rejects.toThrow(ScenarioVersionNotFoundError);

      const stored = await service.getById({ id: scenario.id, projectId });
      expect(stored?.version).toBe(5);
      expect(stored?.situation).toBe("situation v5");
    });

    it("carries the scenario_version_not_found code", async () => {
      const scenario = await createCaseAtVersionFive();

      await expect(
        service.restoreVersion({
          projectId,
          scenarioId: scenario.id,
          version: 9,
          actor: apiActor,
        }),
      ).rejects.toMatchObject({ code: "scenario_version_not_found" });
    });

    /** @scenario "Restoring a version of a scenario in another project is refused with not_found" */
    it("refuses a restore across projects as not found", async () => {
      const scenario = await createCaseAtVersionFive();

      await expect(
        service.restoreVersion({
          projectId: otherProjectId,
          scenarioId: scenario.id,
          version: 2,
          actor: apiActor,
        }),
      ).rejects.toThrow("Scenario not found");

      const stored = await service.getById({ id: scenario.id, projectId });
      expect(stored?.version).toBe(5);
    });

    /** @scenario "Restoring an archived scenario is refused" */
    it("refuses to restore into an archived scenario and keeps it archived", async () => {
      const scenario = await createCaseAtVersionFive();
      await service.archive({ id: scenario.id, projectId });

      await expect(
        service.restoreVersion({
          projectId,
          scenarioId: scenario.id,
          version: 2,
          actor: apiActor,
        }),
      ).rejects.toThrow("Scenario not found");

      const stored = await service.getByIdIncludingArchived({
        id: scenario.id,
        projectId,
      });
      expect(stored?.archivedAt).not.toBeNull();
      expect(stored?.version).toBe(5);
    });
  });
});
