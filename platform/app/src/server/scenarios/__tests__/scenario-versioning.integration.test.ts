/**
 * @vitest-environment node
 *
 * Scenario versioning against a real database: every save writes a numbered
 * version row in the same transaction as the scenario write, concurrent
 * saves never share a number, and a scenario stored before versions existed
 * reads back with a synthesized Created entry.
 *
 * @see specs/scenarios/scenario-versioning.feature
 */
import { nanoid } from "nanoid";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getTestUser } from "../../../utils/testUtils";
import { prisma } from "../../db";
import { DEFAULT_SUITE_NAME } from "../../suites/default-suite";
import { ScenarioStaleVersionError } from "../errors";
import { ScenarioService } from "../scenario.service";

const projectId = `test-scenario-versioning-${nanoid(8)}`;
const otherProjectId = `${projectId}-other`;

const service = ScenarioService.create(prisma);

async function createCase(name = "Refund flow") {
  return service.create(
    {
      projectId,
      name,
      situation: "A customer asks for a refund",
      criteria: ["The agent helps"],
      labels: [],
    },
    { actor: { userId: null, label: "api" } },
  );
}

async function createTestSuite(name: string) {
  const slug = `${name.toLowerCase()}-${nanoid(6)}`;
  return prisma.simulationSuite.create({
    data: {
      projectId,
      name: `${name} ${nanoid(6)}`,
      slug,
      kind: "test_suite",
      scenarioIds: [],
      targets: [],
    },
  });
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

describe("scenario versioning", () => {
  describe("numbering", () => {
    /** @scenario "A new scenario starts at version 1" */
    it("starts a new scenario at version 1 with one entry named Created", async () => {
      const scenario = await createCase();

      expect(scenario.version).toBe(1);

      const { versions } = await service.listVersions({
        projectId,
        scenarioId: scenario.id,
      });
      expect(versions).toHaveLength(1);
      expect(versions[0]).toMatchObject({
        version: 1,
        changeDescription: "Created",
        changedFields: [],
        isSynthesized: false,
      });
    });

    /** @scenario "Each save raises the version by one" */
    it("raises the version by one on each save, listed newest first", async () => {
      const scenario = await createCase();
      await service.update({
        id: scenario.id,
        projectId,
        data: {
          situation: "A customer asks for a replacement",
        },
      });
      await service.update({
        id: scenario.id,
        projectId,
        data: {
          criteria: ["The agent replaces the item"],
        },
      });

      const stored = await service.getById({ id: scenario.id, projectId });
      expect(stored?.version).toBe(3);

      const { versions } = await service.listVersions({
        projectId,
        scenarioId: scenario.id,
      });
      expect(versions.map((v) => v.version)).toEqual([3, 2, 1]);
      expect(versions[0]?.changedFields).toEqual(["criteria"]);
      expect(versions[1]?.changedFields).toEqual(["situation"]);
    });

    /** @scenario "A save that changes nothing still records a version" */
    it("records a version with no changed field for a save that changes nothing", async () => {
      const scenario = await createCase();
      await service.update({
        id: scenario.id,
        projectId,
        data: {
          situation: "A customer asks for a replacement",
        },
      });

      await service.update({
        id: scenario.id,
        projectId,
        data: {
          situation: "A customer asks for a replacement",
        },
      });

      const stored = await service.getById({ id: scenario.id, projectId });
      expect(stored?.version).toBe(3);

      const { versions } = await service.listVersions({
        projectId,
        scenarioId: scenario.id,
      });
      expect(versions[0]).toMatchObject({ version: 3, changedFields: [] });
    });

    it("writes no version for a test suite move", async () => {
      const refunds = await createTestSuite("Refunds");
      const checkout = await createTestSuite("Checkout");
      const scenario = await createCase();

      // Filing, refiling and unfiling: every one of them moves the scenario
      // between real test suites, so an implementation that only skips the
      // version when nothing changed cannot pass by accident. Taking the
      // scenario out of its test suite files it into Default, which is a move
      // between two real test suites as well.
      for (const testSuiteId of [refunds.id, checkout.id, null]) {
        await service.moveToTestSuite({
          scenarioId: scenario.id,
          projectId,
          testSuiteId,
        });
      }

      const defaultSuite = await prisma.simulationSuite.findFirst({
        where: { projectId, kind: "test_suite", name: DEFAULT_SUITE_NAME },
      });
      const stored = await service.getById({ id: scenario.id, projectId });
      expect(stored?.version).toBe(1);
      expect(stored?.testSuiteId).toBe(defaultSuite?.id);
      const rows = await prisma.scenarioVersion.findMany({
        where: { projectId, scenarioId: scenario.id },
      });
      expect(rows).toHaveLength(1);
    });
  });

  describe("what the history shows", () => {
    /** @scenario "A history entry names the number, the author, the date and the changed fields" */
    it("records the author, the date and the changed fields on each entry", async () => {
      const user = await getTestUser();
      const scenario = await createCase();
      await service.update({
        id: scenario.id,
        projectId,
        data: {
          name: "Replacement flow",
          criteria: ["The agent replaces the item"],
        },
        options: { actor: { userId: user.id, label: "user" } },
      });

      const { versions } = await service.listVersions({
        projectId,
        scenarioId: scenario.id,
      });
      const newest = versions[0];
      expect(newest).toMatchObject({
        version: 2,
        authorId: user.id,
        authorLabel: "user",
        changedFields: ["name", "criteria"],
      });
      expect(newest?.createdAt).toBeInstanceOf(Date);
    });

    /** @scenario "A save over the public API is recorded with the API as its author" */
    it("records an API save with the API as its author and no person", async () => {
      const scenario = await createCase();
      await service.update({
        id: scenario.id,
        projectId,
        data: { situation: "Changed over the API" },
        options: { actor: { userId: null, label: "api" } },
      });

      const { versions } = await service.listVersions({
        projectId,
        scenarioId: scenario.id,
      });
      expect(versions[0]).toMatchObject({
        version: 2,
        authorId: null,
        authorLabel: "api",
      });
    });

    /** @scenario "A save from the command line is recorded with the command line as its author" */
    it("records a CLI save with the command line as its author", async () => {
      const scenario = await createCase();
      await service.update({
        id: scenario.id,
        projectId,
        data: { situation: "Changed from the CLI" },
        options: { actor: { userId: null, label: "cli" } },
      });

      const { versions } = await service.listVersions({
        projectId,
        scenarioId: scenario.id,
      });
      expect(versions[0]).toMatchObject({
        version: 2,
        authorId: null,
        authorLabel: "cli",
      });
    });
  });

  describe("concurrent saves", () => {
    /** @scenario "Two saves at the same time produce two different versions" */
    it("gives two simultaneous saves the numbers 5 and 6", async () => {
      const scenario = await createCase();
      for (const text of ["second", "third", "fourth"]) {
        await service.update({
          id: scenario.id,
          projectId,
          data: { situation: text },
        });
      }
      const atFour = await service.getById({ id: scenario.id, projectId });
      expect(atFour?.version).toBe(4);

      await Promise.all([
        service.update({
          id: scenario.id,
          projectId,
          data: { situation: "fifth or sixth" },
        }),
        service.update({
          id: scenario.id,
          projectId,
          data: { situation: "sixth or fifth" },
        }),
      ]);

      const stored = await service.getById({ id: scenario.id, projectId });
      expect(stored?.version).toBe(6);

      const rows = await prisma.scenarioVersion.findMany({
        where: { projectId, scenarioId: scenario.id },
        orderBy: { version: "asc" },
      });
      expect(rows.map((row) => row.version)).toEqual([1, 2, 3, 4, 5, 6]);
    });

    /** @scenario "Saving over a version somebody else already replaced is refused with scenario_stale_version" */
    it("refuses a save against a replaced version and leaves the scenario unchanged", async () => {
      const scenario = await createCase();
      for (const text of ["second", "third", "fourth"]) {
        await service.update({
          id: scenario.id,
          projectId,
          data: { situation: text },
        });
      }

      // Somebody else saves, so the scenario moves to version 5.
      await service.update({
        id: scenario.id,
        projectId,
        data: {
          situation: "somebody else's save",
        },
      });

      await expect(
        service.update({
          id: scenario.id,
          projectId,
          data: { situation: "the stale editor's save" },
          options: { expectedVersion: 4 },
        }),
      ).rejects.toThrow(ScenarioStaleVersionError);

      const stored = await service.getById({ id: scenario.id, projectId });
      expect(stored?.version).toBe(5);
      expect(stored?.situation).toBe("somebody else's save");
    });
  });

  describe("scenarios that existed before versions", () => {
    async function createPreVersioningCase() {
      // Written straight to the table, the way every scenario row existed
      // before versioning: version 1 by column default, no version rows.
      return prisma.scenario.create({
        data: {
          projectId,
          name: "Old scenario",
          situation: "A customer asks for help",
          criteria: ["The agent helps"],
          labels: [],
        },
      });
    }

    /** @scenario "A scenario created before versions existed shows a made-up first entry" */
    it("shows one synthesized Created entry with the creation date", async () => {
      const scenario = await createPreVersioningCase();

      const { versions } = await service.listVersions({
        projectId,
        scenarioId: scenario.id,
      });
      expect(versions).toHaveLength(1);
      expect(versions[0]).toMatchObject({
        version: 1,
        changeDescription: "Created",
        changedFields: [],
        isSynthesized: true,
        authorId: null,
        authorLabel: null,
      });
      expect(versions[0]?.createdAt).toEqual(scenario.createdAt);
    });

    /** @scenario "The first save of a pre-existing scenario starts real history" */
    it("starts real history above the synthesized entry on the first save", async () => {
      const scenario = await createPreVersioningCase();

      await service.update({
        id: scenario.id,
        projectId,
        data: {
          situation: "First save after versioning shipped",
        },
      });

      const stored = await service.getById({ id: scenario.id, projectId });
      expect(stored?.version).toBe(2);

      const { versions } = await service.listVersions({
        projectId,
        scenarioId: scenario.id,
      });
      expect(versions.map((v) => v.version)).toEqual([2, 1]);
      expect(versions[0]?.isSynthesized).toBe(false);
      expect(versions[1]).toMatchObject({
        version: 1,
        changeDescription: "Created",
        isSynthesized: true,
      });
    });
  });

  describe("tenancy", () => {
    /** @scenario "Version history of a scenario in another project is not readable" */
    it("does not read history across projects", async () => {
      const scenario = await createCase();

      await expect(
        service.listVersions({
          projectId: otherProjectId,
          scenarioId: scenario.id,
        }),
      ).rejects.toThrow("Scenario not found");
    });
  });

  describe("duplicates", () => {
    it("starts a duplicate at version 1 with its own v1 row", async () => {
      const scenario = await createCase();
      await service.update({
        id: scenario.id,
        projectId,
        data: {
          situation: "Edited before the copy",
        },
      });

      const copy = await service.duplicate({
        scenarioId: scenario.id,
        projectId,
      });

      expect(copy.version).toBe(1);
      const { versions } = await service.listVersions({
        projectId,
        scenarioId: copy.id,
      });
      expect(versions).toHaveLength(1);
      expect(versions[0]).toMatchObject({
        version: 1,
        changeDescription: "Created",
        isSynthesized: false,
      });
    });
  });
});
