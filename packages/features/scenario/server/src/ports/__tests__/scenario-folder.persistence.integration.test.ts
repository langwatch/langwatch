import type { ScenarioService as ScenarioServiceContract } from "@langwatch/scenario-contract";
import { SimulationService } from "@langwatch/scenario-contract";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaQueryGuard,
  type PrismaQueryContext,
  type PrismaQueryExecutor,
} from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaScenarioAdapter } from "../../index";
import { ScenarioClockPort } from "../scenario-clock.port";
import { ScenarioFolderIdPort, ScenarioIdPort } from "../scenario-id.port";
import { ScenarioSecretCipherPort } from "../scenario-secret-cipher.port";

class AllowTestQueries extends PrismaQueryGuard {
  execute(_context: PrismaQueryContext, next: PrismaQueryExecutor): Promise<unknown> {
    return next(_context.args);
  }
}

class ScenarioIds extends ScenarioIdPort {
  next(): string {
    return `scenario_${randomUUID()}`;
  }
}

class FolderIds extends ScenarioFolderIdPort {
  next(): string {
    return `folder_${randomUUID()}`;
  }
}

class TestClock extends ScenarioClockPort {
  constructor(private readonly value?: Date) {
    super();
  }

  now(): Date {
    return this.value ?? new Date();
  }
}

class TestSecretCipher extends ScenarioSecretCipherPort {
  encrypt(plaintext: string): string {
    return plaintext;
  }

  decrypt(ciphertext: string): string {
    return ciphertext;
  }
}

const databaseUrl = process.env.DATABASE_URL;
const connection = databaseUrl
  ? PrismaConnectionService.create({ guard: new AllowTestQueries() }).connect(
      PrismaConfigService.create().resolve({ databaseUrl, log: ["error"] }),
    )
  : null;

function database(): PrismaClient {
  if (connection === null) {
    throw new Error("DATABASE_URL is required for Scenario folder persistence tests");
  }

  return connection.client;
}

const namespace = `scenario-folder-${randomUUID()}`;
let organizationId = "";
let teamId = "";
let projectId = "";
let otherProjectId = "";

function service(clock = new TestClock()): ScenarioServiceContract {
  const simulations = Object.create(SimulationService.prototype) as SimulationService;

  return PrismaScenarioAdapter.create({
    prisma: database(),
    simulations,
    ids: new ScenarioIds(),
    folderIds: new FolderIds(),
    clock,
    secretCipher: new TestSecretCipher(),
  });
}

async function createScenario(input: { name: string; folderId?: string | null }) {
  return service().create({
    projectId,
    name: input.name,
    situation: "A customer asks for help",
    criteria: ["The agent helps"],
    labels: [],
    ...(input.folderId === undefined ? {} : { folderId: input.folderId }),
  });
}

async function folderScenarioIds(folderId: string): Promise<string[]> {
  const folder = await database().simulationSuite.findFirst({
    where: { id: folderId, projectId },
    select: { scenarioIds: true },
  });

  return folder?.scenarioIds ?? [];
}

async function invariantBreaks(): Promise<string[]> {
  const [folders, activeScenarios] = await Promise.all([
    database().simulationSuite.findMany({
      where: { projectId, kind: "folder", archivedAt: null },
      select: { id: true, scenarioIds: true },
    }),
    database().scenario.findMany({
      where: { projectId, archivedAt: null },
      select: { id: true, folderId: true },
    }),
  ]);

  return folders.flatMap((folder) => {
    const expected = activeScenarios
      .filter((scenario) => scenario.folderId === folder.id)
      .map((scenario) => scenario.id)
      .sort();
    const actual = [...folder.scenarioIds].sort();

    return actual.join(",") === expected.join(",")
      ? []
      : [`folder ${folder.id} holds [${actual.join(", ")}] instead of [${expected.join(", ")}]`];
  });
}

describe.skipIf(!databaseUrl)("Scenario folder persistence", () => {
  beforeAll(async () => {
    const db = database();
    const organization = await db.organization.create({
      data: { name: namespace, slug: namespace },
    });
    organizationId = organization.id;
    const team = await db.team.create({
      data: { name: namespace, slug: namespace, organizationId },
    });
    teamId = team.id;
    const [project, otherProject] = await Promise.all(
      ["main", "other"].map((suffix) =>
        db.project.create({
          data: {
            name: `${namespace}-${suffix}`,
            slug: `${namespace}-${suffix}`,
            apiKey: `${namespace}-${suffix}`,
            teamId,
            language: "typescript",
            framework: "other",
          },
        }),
      ),
    );
    projectId = project.id;
    otherProjectId = otherProject.id;
  });

  beforeEach(async () => {
    const db = database();
    const projectIds = [projectId, otherProjectId];
    await db.scenario.deleteMany({ where: { projectId: { in: projectIds } } });
    await db.simulationSuite.deleteMany({ where: { projectId: { in: projectIds } } });
  });

  afterAll(async () => {
    if (projectId && otherProjectId) {
      const db = database();
      const projectIds = [projectId, otherProjectId];
      await db.scenario.deleteMany({ where: { projectId: { in: projectIds } } });
      await db.simulationSuite.deleteMany({ where: { projectId: { in: projectIds } } });
      await db.project.deleteMany({ where: { id: { in: projectIds } } });
      await db.team.deleteMany({ where: { id: teamId } });
      await db.organization.deleteMany({ where: { id: organizationId } });
    }

    await connection?.closeOnce();
  });

  it("returns the complete folder row and lists only active folders of the project", async () => {
    const folders = service();
    const created = await folders.createFolder({ projectId, name: "Refunds" });
    await folders.createFolder({ projectId: otherProjectId, name: "Other project" });

    expect(created).toMatchObject({
      id: expect.any(String),
      projectId,
      name: "Refunds",
      slug: "refunds",
      description: null,
      scenarioIds: [],
      targets: [],
      repeatCount: 1,
      labels: [],
      simulatorModel: null,
      judgeModel: null,
      kind: "folder",
      scope: null,
      archivedAt: null,
      createdAt: expect.any(Date),
      updatedAt: expect.any(Date),
    });
    await expect(folders.tryGetFolder({ projectId, folderId: created.id })).resolves.toEqual(
      created,
    );
    await expect(folders.listFolders({ projectId })).resolves.toEqual([created]);
  });

  it("creates filed and unfiled cases while reconciling folder membership", async () => {
    const folders = service();
    const refunds = await folders.createFolder({ projectId, name: "Refunds" });
    const first = await createScenario({ name: "First", folderId: refunds.id });
    const unfiled = await createScenario({ name: "Unfiled" });

    expect(first.folderId).toBe(refunds.id);
    expect(unfiled.folderId).toBeNull();
    expect(await folderScenarioIds(refunds.id)).toEqual([first.id]);
    expect(await invariantBreaks()).toEqual([]);
  });

  it("moves a case between folders and then unfiles it", async () => {
    const folders = service();
    const refunds = await folders.createFolder({ projectId, name: "Refunds" });
    const checkout = await folders.createFolder({ projectId, name: "Checkout" });
    const scenario = await createScenario({ name: "Refund", folderId: refunds.id });

    await expect(
      folders.update({ id: scenario.id, projectId, folderId: checkout.id }),
    ).resolves.toMatchObject({ folderId: checkout.id });
    expect(await folderScenarioIds(refunds.id)).toEqual([]);
    expect(await folderScenarioIds(checkout.id)).toEqual([scenario.id]);

    await expect(
      folders.update({ id: scenario.id, projectId, folderId: null }),
    ).resolves.toMatchObject({
      folderId: null,
    });
    expect(await folderScenarioIds(checkout.id)).toEqual([]);
    await expect(folders.list({ projectId })).resolves.toMatchObject([
      { id: scenario.id, folderId: null },
    ]);
    expect(await invariantBreaks()).toEqual([]);
  });

  it("drops an archived case from its folder", async () => {
    const folders = service();
    const folder = await folders.createFolder({ projectId, name: "Refunds" });
    const first = await createScenario({ name: "First", folderId: folder.id });
    const second = await createScenario({ name: "Second", folderId: folder.id });

    await expect(folders.archive({ id: first.id, projectId })).resolves.toMatchObject({
      archivedAt: expect.any(Date),
    });

    expect(await folderScenarioIds(folder.id)).toEqual([second.id]);
    expect(await invariantBreaks()).toEqual([]);
  });

  it("preserves input order, duplicates, retry success, and exact failures in a batch archive", async () => {
    const firstArchiveTime = new Date("2026-01-01T00:00:00.000Z");
    const batchArchiveTime = new Date("2026-01-02T00:00:00.000Z");
    const folders = service(new TestClock(firstArchiveTime));
    const folder = await folders.createFolder({ projectId, name: "Refunds" });
    const cases = await Promise.all(
      ["One", "Two"].map((name) => createScenario({ name, folderId: folder.id })),
    );
    await folders.archive({ id: cases[0]!.id, projectId });

    const requestedIds = [
      cases[1]!.id,
      cases[0]!.id,
      cases[1]!.id,
      "scenario_missing",
      cases[0]!.id,
      "scenario_missing",
    ];
    const batch = await service(new TestClock(batchArchiveTime)).batchArchive({
      projectId,
      ids: requestedIds,
    });
    const stored = await database().scenario.findMany({
      where: { id: { in: cases.map((scenario) => scenario.id) }, projectId },
      select: { id: true, archivedAt: true },
    });

    expect(batch.archived).toEqual([cases[1]!.id, cases[0]!.id, cases[1]!.id, cases[0]!.id]);
    expect(batch.failed).toEqual([
      {
        id: "scenario_missing",
        error: "Not found",
      },
      {
        id: "scenario_missing",
        error: "Not found",
      },
    ]);
    expect(stored).toEqual(
      expect.arrayContaining([
        { id: cases[0]!.id, archivedAt: firstArchiveTime },
        { id: cases[1]!.id, archivedAt: batchArchiveTime },
      ]),
    );
    expect(await folderScenarioIds(folder.id)).toEqual([]);
    expect(await invariantBreaks()).toEqual([]);
  });

  it("rejects archived, non-folder, and cross-project destinations without moving the case", async () => {
    const folders = service();
    const active = await folders.createFolder({ projectId, name: "Active" });
    const archived = await folders.createFolder({ projectId, name: "Archived" });
    const foreign = await folders.createFolder({ projectId: otherProjectId, name: "Foreign" });
    const plan = await database().simulationSuite.create({
      data: {
        projectId,
        name: "Nightly",
        slug: "nightly",
        kind: "custom",
        scenarioIds: [],
        targets: [],
        repeatCount: 1,
        labels: [],
      },
    });
    const scenario = await createScenario({ name: "Refund", folderId: active.id });
    await folders.archiveFolder({ projectId, folderId: archived.id });

    for (const folderId of [archived.id, plan.id, foreign.id]) {
      await expect(folders.update({ id: scenario.id, projectId, folderId })).rejects.toMatchObject({
        code: "scenario_folder_not_found",
      });
      await expect(folders.getById({ id: scenario.id, projectId })).resolves.toMatchObject({
        folderId: active.id,
      });
    }

    expect(await folderScenarioIds(active.id)).toEqual([scenario.id]);
    expect(await invariantBreaks()).toEqual([]);
  });

  it("archives a folder and its active cases while preserving the final member snapshot", async () => {
    const folders = service();
    const folder = await folders.createFolder({ projectId, name: "Refunds" });
    const scenarios = await Promise.all(
      ["One", "Two", "Three"].map((name) => createScenario({ name, folderId: folder.id })),
    );

    const archived = await folders.archiveFolder({ projectId, folderId: folder.id });
    const retried = await folders.archiveFolder({ projectId, folderId: folder.id });
    const archivedScenarios = await database().scenario.findMany({
      where: { id: { in: scenarios.map((scenario) => scenario.id) }, projectId },
      select: { id: true, folderId: true, archivedAt: true },
    });

    expect(archived.archivedAt).toEqual(retried.archivedAt);
    expect(new Set(archived.scenarioIds)).toEqual(
      new Set(scenarios.map((scenario) => scenario.id)),
    );
    expect(archivedScenarios).toEqual(
      expect.arrayContaining(
        scenarios.map((scenario) =>
          expect.objectContaining({
            id: scenario.id,
            folderId: folder.id,
            archivedAt: expect.any(Date),
          }),
        ),
      ),
    );
  });

  it("keeps both simultaneous filings in one folder", async () => {
    const folders = service();
    const folder = await folders.createFolder({ projectId, name: "Refunds" });
    const [first, second] = await Promise.all([
      createScenario({ name: "First" }),
      createScenario({ name: "Second" }),
    ]);

    await Promise.all([
      folders.update({ id: first.id, projectId, folderId: folder.id }),
      folders.update({ id: second.id, projectId, folderId: folder.id }),
    ]);

    expect(new Set(await folderScenarioIds(folder.id))).toEqual(new Set([first.id, second.id]));
    expect(await invariantBreaks()).toEqual([]);
  });

  it("serializes folder archive against creating a filed case", async () => {
    const folders = service();
    const folder = await folders.createFolder({ projectId, name: "Refunds" });

    const [creation, archivedFolder] = await Promise.all([
      createScenario({ name: "Concurrent create", folderId: folder.id }).then(
        (value) => ({ value }),
        (error: unknown) => ({ error }),
      ),
      folders.archiveFolder({ projectId, folderId: folder.id }),
    ]);

    expect(archivedFolder.archivedAt).toEqual(expect.any(Date));
    if ("error" in creation) {
      expect(creation.error).toMatchObject({ code: "scenario_folder_not_found" });
    } else {
      const stored = await database().scenario.findFirstOrThrow({
        where: { id: creation.value.id, projectId },
      });
      expect(stored.archivedAt).toEqual(expect.any(Date));
      expect(archivedFolder.scenarioIds).toContain(creation.value.id);
    }
  });

  it("serializes folder archive against moving a case into the folder", async () => {
    const folders = service();
    const source = await folders.createFolder({ projectId, name: "Source" });
    const destination = await folders.createFolder({ projectId, name: "Destination" });
    const scenario = await createScenario({ name: "Concurrent move", folderId: source.id });

    const [move, archivedFolder] = await Promise.all([
      folders.update({ id: scenario.id, projectId, folderId: destination.id }).then(
        (value) => ({ value }),
        (error: unknown) => ({ error }),
      ),
      folders.archiveFolder({ projectId, folderId: destination.id }),
    ]);
    const stored = await database().scenario.findFirstOrThrow({
      where: { id: scenario.id, projectId },
    });

    expect(archivedFolder.archivedAt).toEqual(expect.any(Date));
    if ("error" in move) {
      expect(move.error).toMatchObject({ code: "scenario_folder_not_found" });
      expect(stored).toMatchObject({ folderId: source.id, archivedAt: null });
    } else {
      expect(stored).toMatchObject({
        folderId: destination.id,
        archivedAt: expect.any(Date),
      });
      expect(archivedFolder.scenarioIds).toContain(scenario.id);
    }
    expect(await invariantBreaks()).toEqual([]);
  });

  it("preserves one timestamp across concurrent folder archive delivery", async () => {
    const firstTime = new Date("2026-02-01T00:00:00.000Z");
    const secondTime = new Date("2026-02-02T00:00:00.000Z");
    const folders = service();
    const folder = await folders.createFolder({ projectId, name: "Refunds" });
    const scenario = await createScenario({ name: "Refund", folderId: folder.id });

    const [first, second] = await Promise.all([
      service(new TestClock(firstTime)).archiveFolder({ projectId, folderId: folder.id }),
      service(new TestClock(secondTime)).archiveFolder({ projectId, folderId: folder.id }),
    ]);
    const storedFolder = await database().simulationSuite.findFirstOrThrow({
      where: { id: folder.id, projectId },
    });
    const storedScenario = await database().scenario.findFirstOrThrow({
      where: { id: scenario.id, projectId },
    });

    expect(first.archivedAt).toEqual(second.archivedAt);
    expect(storedFolder.archivedAt).toEqual(first.archivedAt);
    expect(storedScenario.archivedAt).toEqual(first.archivedAt);
    expect([firstTime, secondTime]).toContainEqual(first.archivedAt);
  });
});
