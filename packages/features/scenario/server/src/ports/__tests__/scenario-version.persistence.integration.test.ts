import {
  ScenarioStaleVersionError,
  ScenarioVersionNotFoundError,
  type Scenario,
  type ScenarioService,
} from "@langwatch/scenario-contract";
import {
  PrismaConfigService,
  PrismaConnectionService,
  PrismaQueryGuard,
  type PrismaQueryContext,
  type PrismaQueryExecutor,
} from "@langwatch/prisma-client";
import type { PrismaClient } from "@langwatch/prisma-client/generated";
import { cleanupTestRows } from "@langwatch/test-harness";
import { SimulationService } from "@langwatch/scenario-contract";
import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { PrismaScenarioAdapter } from "../../index";
import { ScenarioClockPort } from "../scenario-clock.port";
import { ScenarioFolderIdPort, ScenarioIdPort } from "../scenario-id.port";
import { ScenarioSecretCipherPort } from "../scenario-secret-cipher.port";

class AllowTestQueries extends PrismaQueryGuard {
  execute(context: PrismaQueryContext, next: PrismaQueryExecutor): Promise<unknown> {
    return next(context.args);
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
  now(): Date {
    return new Date();
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
  if (!connection) {
    throw new Error("DATABASE_URL is required for Scenario version persistence tests");
  }

  return connection.client;
}

const namespace = `scenario-version-${randomUUID()}`;
let organizationId = "";
let teamId = "";
let projectId = "";
let otherProjectId = "";
let scenarios: ScenarioService;

function createScenario(situation = "situation v1"): Promise<Scenario> {
  return scenarios.create({
    projectId,
    name: "Refund flow",
    situation,
    criteria: ["The agent helps"],
    labels: [],
    actor: { userId: null, label: "api" },
  });
}

async function createScenarioAtVersionFive(): Promise<Scenario> {
  const scenario = await createScenario();

  for (const version of [2, 3, 4, 5]) {
    await scenarios.update({
      id: scenario.id,
      projectId,
      situation: `situation v${version}`,
    });
  }

  return scenario;
}

function nextCursor(page: { nextCursor: number | null }): number {
  if (page.nextCursor === null) {
    throw new Error("Expected another Scenario version page");
  }

  return page.nextCursor;
}

describe.skipIf(!databaseUrl)("Scenario version persistence", () => {
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
    if (!project || !otherProject) {
      throw new Error("Expected both Scenario persistence test projects");
    }

    projectId = project.id;
    otherProjectId = otherProject.id;
    scenarios = PrismaScenarioAdapter.create({
      prisma: db,
      simulations: Object.create(SimulationService.prototype) as SimulationService,
      ids: new ScenarioIds(),
      folderIds: new FolderIds(),
      clock: new TestClock(),
      secretCipher: new TestSecretCipher(),
    });
  });

  beforeEach(async () => {
    const projectIds = [projectId, otherProjectId];
    await database().scenarioVersion.deleteMany({ where: { projectId: { in: projectIds } } });
    await database().scenario.deleteMany({ where: { projectId: { in: projectIds } } });
    await database().simulationSuite.deleteMany({ where: { projectId: { in: projectIds } } });
  });

  afterAll(async () => {
    try {
      if (projectId && otherProjectId) {
        const projectIds = [projectId, otherProjectId];
        await cleanupTestRows(database(), [
          ["scenarioVersion", { projectId: { in: projectIds } }],
          ["scenario", { projectId: { in: projectIds } }],
          ["simulationSuite", { projectId: { in: projectIds } }],
          ["project", { id: { in: projectIds } }],
          ["team", { id: teamId }],
          ["organization", { id: organizationId }],
        ]);
      }
    } finally {
      await connection?.closeOnce();
    }
  });

  it("records complete snapshots, deliberate no-op saves, changed fields and attribution", async () => {
    const scenario = await createScenario();
    await scenarios.update({
      id: scenario.id,
      projectId,
      name: "Replacement flow",
      criteria: ["The agent replaces the item"],
      parameters: [{ name: "tier", defaultValue: "gold" }],
      actor: { userId: "user_lena", label: "user" },
    });
    const saved = await scenarios.update({
      id: scenario.id,
      projectId,
      name: "Replacement flow",
      parameters: [{ name: "tier", defaultValue: "gold" }],
      actor: { userId: null, label: "cli" },
    });

    const history = await scenarios.listVersions({ projectId, scenarioId: scenario.id });
    const firstVersion = await scenarios.getVersion({
      projectId,
      scenarioId: scenario.id,
      version: 1,
    });

    expect(saved.version).toBe(3);
    expect(history).toMatchObject({
      versions: [
        {
          version: 3,
          authorId: null,
          authorLabel: "cli",
          changedFields: [],
          isSynthesized: false,
        },
        {
          version: 2,
          authorId: "user_lena",
          authorLabel: "user",
          changedFields: ["name", "criteria", "parameters"],
          isSynthesized: false,
        },
        {
          version: 1,
          authorId: null,
          authorLabel: "api",
          changeDescription: "Created",
          changedFields: [],
          isSynthesized: false,
        },
      ],
      nextCursor: null,
    });
    expect(history.versions.every((version) => version.createdAt instanceof Date)).toBe(true);
    expect(firstVersion.fields).toMatchObject({
      name: "Refund flow",
      situation: "situation v1",
      criteria: ["The agent helps"],
    });
  });

  it("does not create versions for filing, refiling or unfiling", async () => {
    const firstFolder = await scenarios.createFolder({ projectId, name: "Refunds" });
    const secondFolder = await scenarios.createFolder({ projectId, name: "Checkout" });
    const scenario = await createScenario();

    for (const folderId of [firstFolder.id, secondFolder.id, null]) {
      await scenarios.moveToFolder({ projectId, scenarioId: scenario.id, folderId });
    }

    await expect(scenarios.getById({ id: scenario.id, projectId })).resolves.toMatchObject({
      version: 1,
      folderId: null,
    });
    await expect(
      scenarios.listVersions({ projectId, scenarioId: scenario.id }),
    ).resolves.toMatchObject({ versions: [{ version: 1 }], nextCursor: null });
  });

  it("keeps concurrent saves uniquely and contiguously numbered", async () => {
    const scenario = await createScenario();
    for (const situation of ["second", "third", "fourth"]) {
      await scenarios.update({ id: scenario.id, projectId, situation });
    }

    const [first, second] = await Promise.all([
      scenarios.update({ id: scenario.id, projectId, situation: "fifth or sixth" }),
      scenarios.update({ id: scenario.id, projectId, situation: "sixth or fifth" }),
    ]);
    const history = await scenarios.listVersions({ projectId, scenarioId: scenario.id });

    expect([first.version, second.version].sort()).toEqual([5, 6]);
    expect(history.versions.map((version) => version.version)).toEqual([6, 5, 4, 3, 2, 1]);
  });

  it("refuses a stale expected version without changing the row or history", async () => {
    const scenario = await createScenario();
    await scenarios.update({ id: scenario.id, projectId, situation: "current" });

    await expect(
      scenarios.update({
        id: scenario.id,
        projectId,
        situation: "stale",
        expectedVersion: 1,
      }),
    ).rejects.toMatchObject({
      name: ScenarioStaleVersionError.name,
      code: "scenario_stale_version",
    });
    await expect(scenarios.getById({ id: scenario.id, projectId })).resolves.toMatchObject({
      situation: "current",
      version: 2,
    });
    await expect(
      scenarios.listVersions({ projectId, scenarioId: scenario.id }),
    ).resolves.toMatchObject({ versions: [{ version: 2 }, { version: 1 }] });
  });

  it("pages newest first and synthesizes v1 only on the final legacy page", async () => {
    const row = await database().scenario.create({
      data: {
        projectId,
        name: "Old case",
        situation: "Old situation",
        criteria: [],
        labels: [],
      },
    });
    await scenarios.update({ id: row.id, projectId, situation: "second" });
    await scenarios.update({ id: row.id, projectId, situation: "third" });

    const firstPage = await scenarios.listVersions({
      projectId,
      scenarioId: row.id,
      limit: 1,
    });
    const secondPage = await scenarios.listVersions({
      projectId,
      scenarioId: row.id,
      limit: 1,
      cursor: nextCursor(firstPage),
    });
    const finalPage = await scenarios.listVersions({
      projectId,
      scenarioId: row.id,
      limit: 1,
      cursor: nextCursor(secondPage),
    });

    expect(firstPage).toMatchObject({ versions: [{ version: 3 }], nextCursor: 3 });
    expect(secondPage).toMatchObject({ versions: [{ version: 2 }], nextCursor: 2 });
    expect(finalPage).toEqual({
      versions: [
        {
          version: 1,
          authorId: null,
          authorLabel: null,
          changeDescription: "Created",
          changedFields: [],
          createdAt: row.createdAt,
          isSynthesized: true,
        },
      ],
      nextCursor: null,
    });
  });

  it("starts a duplicate at v1 with its own history and the current content", async () => {
    const folder = await scenarios.createFolder({ projectId, name: "Refunds" });
    const scenario = await scenarios.create({
      projectId,
      name: "Refund flow",
      situation: "situation v1",
      criteria: ["The agent helps"],
      labels: [],
      folderId: folder.id,
    });
    await scenarios.update({ id: scenario.id, projectId, situation: "edited before copy" });

    const duplicate = await scenarios.duplicate({ projectId, scenarioId: scenario.id });
    const history = await scenarios.listVersions({
      projectId,
      scenarioId: duplicate.id,
    });
    const version = await scenarios.getVersion({
      projectId,
      scenarioId: duplicate.id,
      version: 1,
    });

    expect(duplicate).toMatchObject({
      name: "Refund flow (copy)",
      situation: "edited before copy",
      folderId: folder.id,
      version: 1,
    });
    expect(history).toMatchObject({
      versions: [{ version: 1, changeDescription: "Created", isSynthesized: false }],
      nextCursor: null,
    });
    expect(version.fields.situation).toBe("edited before copy");
  });

  it("restores content forward, preserves its folder and can restore the prior content again", async () => {
    const folder = await scenarios.createFolder({ projectId, name: "Refunds" });
    const scenario = await scenarios.create({
      projectId,
      name: "Refund flow",
      situation: "situation v1",
      criteria: [],
      labels: [],
      folderId: folder.id,
    });
    for (const version of [2, 3, 4, 5]) {
      await scenarios.update({
        id: scenario.id,
        projectId,
        situation: `situation v${version}`,
      });
    }

    const restored = await scenarios.restoreVersion({
      projectId,
      scenarioId: scenario.id,
      version: 2,
      actor: { userId: "user_restorer", label: "user" },
    });
    const originalLatest = await scenarios.getVersion({
      projectId,
      scenarioId: scenario.id,
      version: 5,
    });
    const undone = await scenarios.restoreVersion({
      projectId,
      scenarioId: scenario.id,
      version: 5,
      actor: { userId: null, label: "api" },
    });
    const history = await scenarios.listVersions({ projectId, scenarioId: scenario.id });

    expect(restored).toMatchObject({ situation: "situation v2", folderId: folder.id, version: 6 });
    expect(originalLatest.fields.situation).toBe("situation v5");
    expect(undone).toMatchObject({ situation: "situation v5", folderId: folder.id, version: 7 });
    expect(history.versions.slice(0, 2)).toMatchObject([
      { version: 7, changeDescription: "Restored from v5", authorLabel: "api" },
      {
        version: 6,
        changeDescription: "Restored from v2",
        authorId: "user_restorer",
        authorLabel: "user",
      },
    ]);
  });

  it("records restoring the newest version even when its content is unchanged", async () => {
    const scenario = await createScenarioAtVersionFive();
    const restored = await scenarios.restoreVersion({
      projectId,
      scenarioId: scenario.id,
      version: 5,
      actor: { userId: null, label: "api" },
    });
    const history = await scenarios.listVersions({ projectId, scenarioId: scenario.id });

    expect(restored).toMatchObject({ situation: "situation v5", version: 6 });
    expect(history.versions[0]).toMatchObject({
      version: 6,
      changeDescription: "Restored from v5",
      changedFields: [],
    });
  });

  it("keeps version reads and restores tenant scoped", async () => {
    const scenario = await createScenario();

    await expect(
      scenarios.listVersions({ projectId: otherProjectId, scenarioId: scenario.id }),
    ).rejects.toMatchObject({ code: "scenario_not_found" });
    await expect(
      scenarios.getVersion({
        projectId: otherProjectId,
        scenarioId: scenario.id,
        version: 1,
      }),
    ).rejects.toMatchObject({ code: "scenario_not_found" });
    await expect(
      scenarios.restoreVersion({
        projectId: otherProjectId,
        scenarioId: scenario.id,
        version: 1,
        actor: { userId: null, label: "api" },
      }),
    ).rejects.toMatchObject({ code: "scenario_not_found" });
    await expect(scenarios.getById({ id: scenario.id, projectId })).resolves.toMatchObject({
      version: 1,
      situation: "situation v1",
    });
  });

  it("refuses missing-version and archived restores without mutating the scenario", async () => {
    const missingVersionScenario = await createScenarioAtVersionFive();
    await expect(
      scenarios.restoreVersion({
        projectId,
        scenarioId: missingVersionScenario.id,
        version: 9,
        actor: { userId: null, label: "api" },
      }),
    ).rejects.toBeInstanceOf(ScenarioVersionNotFoundError);
    await expect(
      scenarios.getById({ id: missingVersionScenario.id, projectId }),
    ).resolves.toMatchObject({ version: 5, situation: "situation v5" });

    const archivedScenario = await createScenario();
    await scenarios.archive({ id: archivedScenario.id, projectId });
    await expect(
      scenarios.restoreVersion({
        projectId,
        scenarioId: archivedScenario.id,
        version: 1,
        actor: { userId: null, label: "api" },
      }),
    ).rejects.toMatchObject({ code: "scenario_not_found" });
    await expect(
      scenarios.tryGetByIdIncludingArchived({ id: archivedScenario.id, projectId }),
    ).resolves.toMatchObject({ version: 1, archivedAt: expect.any(Date) });
  });
});
