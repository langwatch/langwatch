/**
 * @vitest-environment node
 *
 * Residual until Scenario version restore owns clearing archivedAt and folder
 * reconciliation in the same transaction. Folder creation, filing, archive,
 * batch archive, and locking coverage live in scenario-server now.
 */
import { nanoid } from "nanoid";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { getTestUser } from "../../../utils/testUtils";
import { prisma } from "../../db";
import { reconcileFolderMembership } from "../../suites/folder-membership";
import { ScenarioService } from "../scenario.service";

const projectId = `test-scenario-folder-restore-${nanoid(8)}`;
const service = ScenarioService.create(prisma);

async function createFolder() {
  return prisma.simulationSuite.create({
    data: {
      projectId,
      name: "Refunds",
      slug: `refunds-${nanoid(6)}`,
      kind: "folder",
      scenarioIds: [],
      targets: [],
      labels: [],
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
  await prisma.project.upsert({
    where: { id: projectId },
    update: {},
    create: {
      id: projectId,
      name: projectId,
      slug: projectId,
      apiKey: `sk-lw-${projectId}`,
      teamId: team!.id,
      language: "en",
      framework: "test",
    },
  });
});

beforeEach(async () => {
  await prisma.scenario.deleteMany({ where: { projectId } });
  await prisma.simulationSuite.deleteMany({ where: { projectId } });
});

describe("scenario folder restoration residual", () => {
  it("reconciles the original folder after an archived scenario is restored", async () => {
    const folder = await createFolder();
    const scenario = await service.create({
      projectId,
      name: "Refund",
      situation: "A customer asks for help",
      criteria: ["The agent helps"],
      labels: [],
      folderId: folder.id,
    });
    await service.archive({ id: scenario.id, projectId });

    await prisma.$transaction(async (transaction) => {
      await transaction.scenario.update({
        where: { id: scenario.id, projectId },
        data: { archivedAt: null },
      });
      await reconcileFolderMembership({ projectId, folderId: folder.id, tx: transaction });
    });

    const restoredFolder = await prisma.simulationSuite.findFirst({
      where: { id: folder.id, projectId },
      select: { scenarioIds: true },
    });
    expect(restoredFolder?.scenarioIds).toEqual([scenario.id]);
  });
});
