import {
  Prisma,
  type PrismaClient,
  type Scenario as PrismaScenario,
  type SimulationSuite,
} from "@langwatch/prisma-client/generated";
import {
  scenarioFolderSchema,
  ScenarioNotFoundError,
  ScenarioFolderNotFoundError,
  ScenarioFolderSlugUnavailableError,
  scenarioRunConfigSchema,
  scenarioSchema,
  type Scenario,
  type ScenarioCreateInput,
  type ScenarioFolder,
  type ScenarioFolderCreateInput,
  type ScenarioFolderIdInput,
  type ScenarioFolderRenameInput,
  type ScenarioFolderRunDefinition,
  type ScenarioFolderUpdateInput,
  type ScenarioReferenceState,
  type ScenarioRunConfig,
  type ScenarioUpdateInput,
} from "@langwatch/scenario-contract";
import { ScenarioRepository } from "../scenario.repository";

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "folder"
  );
}

function mapFolder(row: unknown): ScenarioFolder {
  return scenarioFolderSchema.parse(row);
}

export class PrismaScenarioRepository extends ScenarioRepository {
  static create(database: PrismaClient): PrismaScenarioRepository {
    return new PrismaScenarioRepository(database);
  }

  private constructor(private readonly database: PrismaClient) {
    super();
  }

  async create(input: ScenarioCreateInput & { id: string }): Promise<Scenario> {
    return this.database.$transaction(async (transaction) => {
      if (input.folderId) {
        const folders = await this.lockFolders(transaction, input.projectId, [input.folderId]);
        this.assertAssignableFolder(folders.get(input.folderId));
      }

      const row = await transaction.scenario.create({
        data: { ...input, parameters: input.parameters ?? undefined },
      });
      if (input.folderId) {
        await this.reconcileLockedFolder(transaction, input.projectId, input.folderId);
      }
      return scenarioSchema.parse(row);
    });
  }

  async tryFindById(input: { id: string; projectId: string }): Promise<Scenario | null> {
    const row = await this.database.scenario.findFirst({
      where: { ...input, archivedAt: null },
    });
    return row ? scenarioSchema.parse(row) : null;
  }

  async tryFindByIdIncludingArchived(input: {
    id: string;
    projectId: string;
  }): Promise<Scenario | null> {
    const row = await this.database.scenario.findFirst({ where: input });
    return row ? scenarioSchema.parse(row) : null;
  }

  async findAll(input: { projectId: string }): Promise<Scenario[]> {
    const rows = await this.database.scenario.findMany({
      where: { ...input, archivedAt: null },
      orderBy: { updatedAt: "desc" },
    });
    return rows.map((row) => scenarioSchema.parse(row));
  }

  count(input: { projectId: string }): Promise<number> {
    return this.database.scenario.count({
      where: { projectId: input.projectId, archivedAt: null },
    });
  }

  async update(input: ScenarioUpdateInput): Promise<Scenario> {
    return this.database.$transaction(async (transaction) => {
      const current = await this.lockScenario(transaction, input.projectId, input.id);
      if (!current || current.archivedAt) throw new ScenarioNotFoundError(input.id);

      const touchedFolderIds = input.folderId === void 0 ? [] : [current.folderId, input.folderId];
      const folders = await this.lockFolders(transaction, input.projectId, touchedFolderIds);
      if (input.folderId) {
        this.assertAssignableFolder(folders.get(input.folderId));
      }

      const { id, projectId, ...data } = input;
      const row = await transaction.scenario.update({
        where: { id, projectId },
        data,
      });
      if (data.folderId !== undefined) {
        await this.reconcileLockedFolders(transaction, projectId, touchedFolderIds);
      }
      return scenarioSchema.parse(row);
    });
  }

  async tryArchive(input: {
    id: string;
    projectId: string;
    archivedAt: Date;
  }): Promise<Scenario | null> {
    return this.database.$transaction(async (transaction) => {
      const found = await this.lockScenario(transaction, input.projectId, input.id);
      if (!found) return null;
      if (found.archivedAt) return scenarioSchema.parse(found);

      const folders = await this.lockFolders(transaction, input.projectId, [found.folderId]);

      const row = await transaction.scenario.update({
        where: { id: input.id, projectId: input.projectId },
        data: { archivedAt: input.archivedAt },
      });
      const folder = found.folderId ? folders.get(found.folderId) : void 0;
      if (found.folderId && folder?.kind === "folder" && folder.archivedAt === null) {
        await this.reconcileLockedFolder(transaction, input.projectId, found.folderId);
      }
      return scenarioSchema.parse(row);
    });
  }

  async archiveMany(input: {
    ids: string[];
    projectId: string;
    archivedAt: Date;
  }): Promise<{ archived: string[]; missing: string[] }> {
    return this.database.$transaction(async (transaction) => {
      const rows = await this.lockScenarios(transaction, input.projectId, input.ids);
      const rowsById = new Map(rows.map((row) => [row.id, row]));
      const archived = input.ids.filter((id) => rowsById.has(id));
      const missing = input.ids.filter((id) => !rowsById.has(id));
      const activeRows = rows.filter((row) => row.archivedAt === null);
      if (activeRows.length === 0) return { archived, missing };

      const folderIds = activeRows.map((row) => row.folderId);
      await this.lockFolders(transaction, input.projectId, folderIds);

      await transaction.scenario.updateMany({
        where: {
          id: { in: activeRows.map((row) => row.id) },
          projectId: input.projectId,
          archivedAt: null,
        },
        data: { archivedAt: input.archivedAt },
      });
      await this.reconcileLockedFolders(transaction, input.projectId, folderIds);
      return { archived, missing };
    });
  }

  async findRunConfigs(input: { ids: string[]; projectId: string }): Promise<ScenarioRunConfig[]> {
    const rows = await this.database.scenario.findMany({
      where: { id: { in: input.ids }, projectId: input.projectId },
      select: {
        id: true,
        name: true,
        version: true,
        situation: true,
        criteria: true,
        parameters: true,
      },
    });
    return rows.map((row) => scenarioRunConfigSchema.parse(row));
  }

  async findReferenceStates(input: {
    ids: string[];
    projectId: string;
  }): Promise<ScenarioReferenceState[]> {
    const rows = await this.database.scenario.findMany({
      where: { id: { in: input.ids }, projectId: input.projectId },
      select: { id: true, archivedAt: true },
    });
    return rows.map((row) => scenarioSchema.pick({ id: true, archivedAt: true }).parse(row));
  }

  async findNamesByIds(input: {
    ids: string[];
    projectId: string;
  }): Promise<{ id: string; name: string }[]> {
    const rows = await this.database.scenario.findMany({
      where: { id: { in: input.ids }, projectId: input.projectId },
      select: { id: true, name: true },
    });
    return rows.map((row) => scenarioSchema.pick({ id: true, name: true }).parse(row));
  }

  async createFolder(input: ScenarioFolderCreateInput & { id: string }): Promise<ScenarioFolder> {
    const baseSlug = slugify(input.name);
    for (let suffix = 0; suffix < 100; suffix += 1) {
      const slug = suffix === 0 ? baseSlug : `${baseSlug}-${suffix + 1}`;
      try {
        const row = await this.database.simulationSuite.create({
          data: {
            id: input.id,
            projectId: input.projectId,
            name: input.name,
            slug,
            kind: "folder",
            scenarioIds: [],
            targets: [],
            repeatCount: 1,
            labels: [],
          },
        });
        return mapFolder(row);
      } catch (error) {
        if (!this.isSlugConflict(error)) throw error;
      }
    }
    throw new ScenarioFolderSlugUnavailableError();
  }

  async findFolders(input: { projectId: string }): Promise<ScenarioFolder[]> {
    const rows = await this.database.simulationSuite.findMany({
      where: { projectId: input.projectId, kind: "folder", archivedAt: null },
      orderBy: { updatedAt: "desc" },
    });
    return rows.map(mapFolder);
  }

  async tryFindFolder(input: ScenarioFolderIdInput): Promise<ScenarioFolder | null> {
    const row = await this.database.simulationSuite.findFirst({
      where: {
        id: input.folderId,
        projectId: input.projectId,
        kind: "folder",
        archivedAt: null,
      },
    });
    return row ? mapFolder(row) : null;
  }

  async renameFolder(input: ScenarioFolderRenameInput): Promise<ScenarioFolder> {
    return this.database.$transaction(async (transaction) => {
      const folders = await this.lockFolders(transaction, input.projectId, [input.folderId]);
      this.assertAssignableFolder(folders.get(input.folderId));

      const row = await transaction.simulationSuite.update({
        where: { id: input.folderId, projectId: input.projectId },
        data: { name: input.name },
      });
      return mapFolder(row);
    });
  }

  async updateFolder(input: ScenarioFolderUpdateInput): Promise<ScenarioFolder> {
    const { folderId, projectId, targets, ...data } = input;
    const found = await this.database.simulationSuite.findFirst({
      where: { id: folderId, projectId, kind: "folder", archivedAt: null },
      select: { id: true },
    });
    if (!found) throw new ScenarioFolderNotFoundError();

    const row = await this.database.simulationSuite.update({
      where: { id: folderId, projectId },
      data: {
        ...data,
        ...(targets === void 0 ? {} : { targets: targets as Prisma.InputJsonValue }),
      },
    });
    return mapFolder(row);
  }

  async getFolderRunDefinition(input: ScenarioFolderIdInput): Promise<ScenarioFolderRunDefinition> {
    return this.database.$transaction(async (transaction) => {
      const folder = await transaction.simulationSuite.findFirst({
        where: {
          id: input.folderId,
          projectId: input.projectId,
          kind: "folder",
          archivedAt: null,
        },
      });
      if (!folder) throw new ScenarioFolderNotFoundError();

      const scenarios = await transaction.scenario.findMany({
        where: { projectId: input.projectId, folderId: input.folderId },
        select: { id: true },
        orderBy: { createdAt: "asc" },
      });
      return {
        folder: mapFolder(folder),
        scenarioIds: scenarios.map((scenario) => scenario.id),
      };
    });
  }

  async archiveFolder(
    input: ScenarioFolderIdInput & { archivedAt: Date },
  ): Promise<ScenarioFolder> {
    return this.database.$transaction(async (transaction) => {
      const memberRows = await transaction.scenario.findMany({
        where: { projectId: input.projectId, folderId: input.folderId },
        select: { id: true },
      });
      await this.lockScenarios(
        transaction,
        input.projectId,
        memberRows.map((row) => row.id),
      );
      const folders = await this.lockFolders(transaction, input.projectId, [input.folderId]);
      const folder = folders.get(input.folderId);
      if (!folder || folder.kind !== "folder") throw new ScenarioFolderNotFoundError();
      if (folder.archivedAt) return mapFolder(folder);

      await transaction.scenario.updateMany({
        where: { projectId: input.projectId, folderId: input.folderId, archivedAt: null },
        data: { archivedAt: input.archivedAt },
      });
      const archivedSlug = folder.slug.endsWith("--archived")
        ? folder.slug
        : `${folder.slug}--archived-${folder.id.slice(-6)}`;
      const row = await transaction.simulationSuite.update({
        where: { id: input.folderId, projectId: input.projectId },
        data: { archivedAt: input.archivedAt, slug: archivedSlug },
      });
      return mapFolder(row);
    });
  }

  private assertAssignableFolder(folder: SimulationSuite | undefined): void {
    if (!folder || folder.kind !== "folder" || folder.archivedAt !== null) {
      throw new ScenarioFolderNotFoundError();
    }
  }

  private async lockScenario(
    transaction: Prisma.TransactionClient,
    projectId: string,
    scenarioId: string,
  ): Promise<PrismaScenario | null> {
    await transaction.$executeRaw`
      SELECT id
      FROM "Scenario"
      WHERE id = ${scenarioId} AND "projectId" = ${projectId}
      FOR UPDATE
    `;
    return transaction.scenario.findFirst({
      where: { id: scenarioId, projectId },
    });
  }

  private async lockScenarios(
    transaction: Prisma.TransactionClient,
    projectId: string,
    scenarioIds: string[],
  ): Promise<PrismaScenario[]> {
    const ids = [...new Set(scenarioIds)].sort();
    const rows: PrismaScenario[] = [];
    for (const scenarioId of ids) {
      const row = await this.lockScenario(transaction, projectId, scenarioId);
      if (row) rows.push(row);
    }
    return rows;
  }

  private async lockFolders(
    transaction: Prisma.TransactionClient,
    projectId: string,
    folderIds: Array<string | null | undefined>,
  ): Promise<Map<string, SimulationSuite>> {
    const ids = [
      ...new Set(folderIds.filter((folderId): folderId is string => typeof folderId === "string")),
    ].sort();
    const folders = new Map<string, SimulationSuite>();
    for (const folderId of ids) {
      await transaction.$executeRaw`
        SELECT id
        FROM "SimulationSuite"
        WHERE id = ${folderId} AND "projectId" = ${projectId}
        FOR UPDATE
      `;
      const folder = await transaction.simulationSuite.findFirst({
        where: { id: folderId, projectId },
      });
      if (folder) folders.set(folderId, folder);
    }
    return folders;
  }

  private async reconcileLockedFolders(
    transaction: Prisma.TransactionClient,
    projectId: string,
    folderIds: Array<string | null | undefined>,
  ): Promise<void> {
    const ids = [
      ...new Set(folderIds.filter((folderId): folderId is string => typeof folderId === "string")),
    ].sort();
    for (const folderId of ids) {
      await this.reconcileLockedFolder(transaction, projectId, folderId);
    }
  }

  private async reconcileLockedFolder(
    transaction: Prisma.TransactionClient,
    projectId: string,
    folderId: string,
  ): Promise<void> {
    const members = await transaction.scenario.findMany({
      where: { projectId, folderId, archivedAt: null },
      select: { id: true },
      orderBy: { createdAt: "asc" },
    });
    await transaction.simulationSuite.update({
      where: { id: folderId, projectId },
      data: { scenarioIds: members.map((member) => member.id) },
    });
  }

  private isSlugConflict(error: unknown): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
  }
}
