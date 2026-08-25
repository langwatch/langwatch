/**
 * @vitest-environment node
 *
 * The folder membership invariant, walked against a real database:
 * Scenario.folderId is the source of truth, the folder's scenarioIds is a
 * reconciled copy, and every membership write keeps the two in step inside
 * its own transaction.
 *
 * @see specs/suites/folder-membership-invariant.feature
 * @see specs/scenarios/scenario-folder-assignment.feature
 */
import { nanoid } from "nanoid";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { SuiteRunService } from "~/server/app-layer/suites/suite-run.service";
import { getTestUser } from "../../../utils/testUtils";
import { prisma } from "../../db";
import { ScenarioService } from "../../scenarios/scenario.service";
import { reconcileFolderMembership } from "../folder-membership";
import { SuiteService } from "../suite.service";

const projectId = `test-folder-membership-${nanoid(8)}`;
const otherProjectId = `${projectId}-other`;

const scenarioService = ScenarioService.create(prisma);
// The run service is never reached by membership writes; a stub keeps the
// test on the datastore path only.
const suiteService = SuiteService.create({
  prisma,
  suiteRunService: {} as SuiteRunService,
});

async function createFolder(name: string, project = projectId) {
  return suiteService.createFolder({ projectId: project, name });
}

async function createCase({
  name,
  folderId,
  project = projectId,
}: {
  name: string;
  folderId?: string | null;
  project?: string;
}) {
  return scenarioService.create({
    projectId: project,
    name,
    situation: "A customer asks for help",
    criteria: ["The agent helps"],
    labels: [],
    ...(folderId !== undefined && { folderId }),
  });
}

async function folderScenarioIds(folderId: string): Promise<string[]> {
  const folder = await prisma.simulationSuite.findFirst({
    where: { id: folderId, projectId },
  });
  return folder?.scenarioIds ?? [];
}

/**
 * The invariant itself: every active case's folderId agrees with every
 * folder's scenarioIds, in both directions.
 */
async function expectInvariantHolds() {
  const folders = await prisma.simulationSuite.findMany({
    where: { projectId, kind: "folder", archivedAt: null },
  });
  const activeCases = await prisma.scenario.findMany({
    where: { projectId, archivedAt: null },
    select: { id: true, folderId: true },
  });
  for (const folder of folders) {
    const namedMembers = activeCases
      .filter((scenario) => scenario.folderId === folder.id)
      .map((scenario) => scenario.id)
      .sort();
    expect([...folder.scenarioIds].sort()).toEqual(namedMembers);
  }
  for (const scenario of activeCases) {
    for (const folder of folders) {
      if (scenario.folderId !== folder.id) {
        expect(folder.scenarioIds).not.toContain(scenario.id);
      }
    }
  }
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

describe("folder membership", () => {
  describe("when a case is created inside a folder", () => {
    /** @scenario "Creating a case inside a folder puts it on both sides at once" */
    /** @scenario "A case created from inside a suite is filed into that suite" */
    it("names the folder on the case and holds the case on the folder", async () => {
      const folder = await createFolder("Refunds");
      const scenario = await createCase({
        name: "Refund",
        folderId: folder.id,
      });

      expect(scenario.folderId).toBe(folder.id);
      expect(await folderScenarioIds(folder.id)).toEqual([scenario.id]);
      await expectInvariantHolds();
    });

    /** @scenario "A case created from the All test cases view starts unfiled" */
    it("leaves a case created without a folder unfiled", async () => {
      const scenario = await createCase({ name: "Unfiled" });

      expect(scenario.folderId).toBeNull();
      await expectInvariantHolds();
    });
  });

  describe("when a case moves between folders", () => {
    /** @scenario "Moving a case between folders updates both folders" */
    it("updates both folders in one write", async () => {
      const refunds = await createFolder("Refunds");
      const checkout = await createFolder("Checkout");
      const scenario = await createCase({
        name: "Refund",
        folderId: refunds.id,
      });

      const moved = await scenarioService.moveToFolder({
        scenarioId: scenario.id,
        projectId,
        folderId: checkout.id,
      });

      expect(moved.folderId).toBe(checkout.id);
      expect(await folderScenarioIds(checkout.id)).toEqual([scenario.id]);
      expect(await folderScenarioIds(refunds.id)).toEqual([]);
      await expectInvariantHolds();
    });

    /** @scenario "Unfiling a case removes it from its folder" */
    it("unfiles a case with a null folder and keeps it listed", async () => {
      const refunds = await createFolder("Refunds");
      const scenario = await createCase({
        name: "Refund",
        folderId: refunds.id,
      });

      const unfiled = await scenarioService.moveToFolder({
        scenarioId: scenario.id,
        projectId,
        folderId: null,
      });

      expect(unfiled.folderId).toBeNull();
      expect(await folderScenarioIds(refunds.id)).toEqual([]);
      const listed = await scenarioService.getAll({ projectId });
      expect(listed.map((s) => s.id)).toContain(scenario.id);
      await expectInvariantHolds();
    });

    /** @scenario "A move that fails leaves both sides untouched" */
    /** @scenario "A case cannot be filed into an archived folder" */
    it("leaves both sides untouched when the destination is refused", async () => {
      const refunds = await createFolder("Refunds");
      const archived = await createFolder("Old");
      await suiteService.archiveFolder({ projectId, folderId: archived.id });
      const scenario = await createCase({
        name: "Refund",
        folderId: refunds.id,
      });

      await expect(
        scenarioService.moveToFolder({
          scenarioId: scenario.id,
          projectId,
          folderId: archived.id,
        }),
      ).rejects.toMatchObject({ code: "scenario_folder_not_found" });

      const kept = await prisma.scenario.findFirst({
        where: { id: scenario.id, projectId },
      });
      expect(kept?.folderId).toBe(refunds.id);
      expect(await folderScenarioIds(refunds.id)).toEqual([scenario.id]);
      await expectInvariantHolds();
    });

    /** @scenario "A case cannot be filed into a run plan that is not a folder" */
    it("refuses to file a case into a custom run plan", async () => {
      const refunds = await createFolder("Refunds");
      const scenario = await createCase({
        name: "Refund",
        folderId: refunds.id,
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
        scenarioService.moveToFolder({
          scenarioId: scenario.id,
          projectId,
          folderId: plan.id,
        }),
      ).rejects.toMatchObject({ code: "scenario_folder_not_found" });

      const kept = await prisma.scenario.findFirst({
        where: { id: scenario.id, projectId },
      });
      expect(kept?.folderId).toBe(refunds.id);
    });

    /** @scenario "Filing a case into a suite of another project is refused with scenario_folder_not_found" */
    it("refuses a folder that belongs to another project", async () => {
      const foreign = await createFolder("Foreign", otherProjectId);
      const refunds = await createFolder("Refunds");
      const scenario = await createCase({
        name: "Refund",
        folderId: refunds.id,
      });

      await expect(
        scenarioService.moveToFolder({
          scenarioId: scenario.id,
          projectId,
          folderId: foreign.id,
        }),
      ).rejects.toMatchObject({ code: "scenario_folder_not_found" });

      const kept = await prisma.scenario.findFirst({
        where: { id: scenario.id, projectId },
      });
      expect(kept?.folderId).toBe(refunds.id);
    });
  });

  describe("when cases are archived", () => {
    /** @scenario "Archiving one case drops it from its folder" */
    it("drops the archived case from the folder and keeps the rest", async () => {
      const refunds = await createFolder("Refunds");
      const first = await createCase({ name: "One", folderId: refunds.id });
      const second = await createCase({ name: "Two", folderId: refunds.id });

      await scenarioService.archive({ id: first.id, projectId });

      expect(await folderScenarioIds(refunds.id)).toEqual([second.id]);
      await expectInvariantHolds();
    });

    /** @scenario "Archiving many cases at once drops all of them from their folders" */
    it("recomputes the folder once for a batch archive", async () => {
      const refunds = await createFolder("Refunds");
      const cases = [];
      for (const name of ["One", "Two", "Three", "Four"]) {
        cases.push(await createCase({ name, folderId: refunds.id }));
      }

      const result = await scenarioService.batchArchive({
        ids: cases.slice(0, 3).map((scenario) => scenario.id),
        projectId,
      });

      expect(result.archived).toHaveLength(3);
      expect(result.failed).toHaveLength(0);
      expect(await folderScenarioIds(refunds.id)).toEqual([cases[3]!.id]);
      await expectInvariantHolds();
    });

    /** @scenario "Restoring an archived case puts it back in its folder" */
    it("puts a restored case back through the reconcile", async () => {
      const refunds = await createFolder("Refunds");
      const scenario = await createCase({
        name: "Refund",
        folderId: refunds.id,
      });
      await scenarioService.archive({ id: scenario.id, projectId });
      expect(await folderScenarioIds(refunds.id)).toEqual([]);

      // The restore path clears archivedAt and reconciles, exactly like every
      // other membership write.
      await prisma.$transaction(async (tx) => {
        await tx.scenario.update({
          where: { id: scenario.id, projectId },
          data: { archivedAt: null },
        });
        await reconcileFolderMembership({
          projectId,
          folderId: refunds.id,
          tx,
        });
      });

      expect(await folderScenarioIds(refunds.id)).toEqual([scenario.id]);
      await expectInvariantHolds();
    });
  });

  describe("when a folder is archived", () => {
    /** @scenario "An archived folder keeps the membership it had" */
    it("keeps the final member list as a snapshot and archives the cases", async () => {
      const refunds = await createFolder("Refunds");
      const caseIds = [];
      for (const name of ["One", "Two", "Three"]) {
        const scenario = await createCase({ name, folderId: refunds.id });
        caseIds.push(scenario.id);
      }

      await suiteService.archiveFolder({ projectId, folderId: refunds.id });

      const archivedFolder = await prisma.simulationSuite.findFirst({
        where: { id: refunds.id, projectId },
      });
      expect(archivedFolder?.archivedAt).not.toBeNull();
      expect([...(archivedFolder?.scenarioIds ?? [])].sort()).toEqual(
        [...caseIds].sort(),
      );
      const archivedCases = await prisma.scenario.findMany({
        where: { id: { in: caseIds }, projectId },
      });
      expect(archivedCases).toHaveLength(3);
      for (const archivedCase of archivedCases) {
        expect(archivedCase.archivedAt).not.toBeNull();
        expect(archivedCase.folderId).toBe(refunds.id);
      }
    });
  });

  describe("when a duplicate is made", () => {
    /** @scenario "Duplicating a case copies its suite" */
    it("files the copy in the same folder with the same definition", async () => {
      const refunds = await createFolder("Refunds");
      const scenario = await scenarioService.create({
        projectId,
        name: "Refund",
        situation: "A {{ params.tier }} customer wants a refund",
        criteria: ["The agent refunds"],
        labels: ["billing"],
        parameters: [{ name: "tier", defaultValue: "gold" }],
        folderId: refunds.id,
      });

      const copy = await scenarioService.duplicate({
        scenarioId: scenario.id,
        projectId,
      });

      expect(copy.id).not.toBe(scenario.id);
      expect(copy.name).toBe("Refund (copy)");
      expect(copy.folderId).toBe(refunds.id);
      expect(copy.situation).toBe(scenario.situation);
      expect(copy.criteria).toEqual(scenario.criteria);
      expect(copy.labels).toEqual(scenario.labels);
      expect(copy.parameters).toEqual(scenario.parameters);
      expect(await folderScenarioIds(refunds.id)).toEqual([
        scenario.id,
        copy.id,
      ]);
      await expectInvariantHolds();
    });
  });

  describe("when cases are created, moved, archived and batch-archived in turn", () => {
    /** @scenario "The two sides agree after a full create, move, archive and batch-archive walk" */
    it("holds the invariant after every step", async () => {
      const refunds = await createFolder("Refunds");
      const checkout = await createFolder("Checkout");

      const cases = [];
      for (let i = 0; i < 5; i++) {
        cases.push(
          await createCase({
            name: `Case ${i}`,
            folderId: i < 3 ? refunds.id : checkout.id,
          }),
        );
      }
      await expectInvariantHolds();

      await scenarioService.moveToFolder({
        scenarioId: cases[0]!.id,
        projectId,
        folderId: checkout.id,
      });
      await expectInvariantHolds();

      await scenarioService.archive({ id: cases[3]!.id, projectId });
      await expectInvariantHolds();

      await scenarioService.batchArchive({
        ids: [cases[1]!.id, cases[4]!.id],
        projectId,
      });
      await expectInvariantHolds();

      expect(await folderScenarioIds(refunds.id)).toEqual([cases[2]!.id]);
      expect(await folderScenarioIds(checkout.id)).toEqual([cases[0]!.id]);
    });
  });
});
