import {
  Prisma,
  type PrismaClient,
  type Scenario as PrismaScenario,
  type ScenarioVersion as PrismaScenarioVersion,
  type SimulationSuite,
} from "@langwatch/prisma-client/generated";
import {
  buildSnapshotEnvelope,
  changedSnapshotFields,
  parseSnapshotEnvelope,
  scenarioAuthorLabelSchema,
  scenarioTestSuiteSchema,
  scenarioRunConfigSchema,
  scenarioSchema,
  scenarioSnapshotSchemaVersion,
  ScenarioTestSuiteNotFoundError,
  ScenarioTestSuiteSlugUnavailableError,
  ScenarioNotFoundError,
  ScenarioStaleVersionError,
  ScenarioVersionNotFoundError,
  snapshotFieldsOf,
  touchesVersionedFields,
  type Scenario,
  type ScenarioActor,
  type ScenarioCreateInput,
  type ScenarioTestSuite,
  type ScenarioTestSuiteCreateInput,
  type ScenarioTestSuiteIdInput,
  type ScenarioTestSuiteRenameInput,
  type ScenarioTestSuiteRunDefinition,
  type ScenarioTestSuiteUpdateInput,
  type ScenarioReferenceState,
  type ScenarioRunConfig,
  type ScenarioUpdateInput,
  type ScenarioVersionDetail,
  type ScenarioVersionInput,
  type ScenarioVersionListInput,
  type ScenarioVersionRestoreInput,
  type ScenarioVersionSummary,
} from "@langwatch/scenario-contract";
import { ScenarioRepository } from "../scenario.repository";

type ScenarioWriteInput = ScenarioUpdateInput & { actor: ScenarioActor };

function slugify(value: string): string {
  return (
    value
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "") || "test-suite"
  );
}

function mapTestSuite(row: unknown): ScenarioTestSuite {
  return scenarioTestSuiteSchema.parse(row);
}

function mapVersionSummary(row: PrismaScenarioVersion): ScenarioVersionSummary {
  const envelope = parseSnapshotEnvelope(row.snapshot);
  return {
    version: row.version,
    authorId: row.authorId,
    authorLabel: scenarioAuthorLabelSchema.parse(row.authorLabel),
    changeDescription: row.changeDescription,
    changedFields: envelope.changedFields,
    createdAt: row.createdAt,
    isSynthesized: false,
  };
}

type ScenarioIdentity = {
  id: string;
  projectId: string;
};

function scenarioWhere(
  input: ScenarioIdentity,
  includeArchived: boolean,
): Prisma.ScenarioWhereInput {
  return includeArchived ? input : { ...input, archivedAt: null };
}

export class PrismaScenarioRepository extends ScenarioRepository {
  static create(database: PrismaClient): PrismaScenarioRepository {
    return new PrismaScenarioRepository(database);
  }

  private constructor(private readonly database: PrismaClient) {
    super();
  }

  async create(
    input: ScenarioCreateInput & { id: string; actor: ScenarioActor },
  ): Promise<Scenario> {
    return this.database.$transaction(async (transaction) => {
      if (input.testSuiteId) {
        const testSuites = await this.lockTestSuites(transaction, input.projectId, [
          input.testSuiteId,
        ]);
        this.assertAssignableTestSuite(input.testSuiteId, testSuites.get(input.testSuiteId));
      }

      const { actor, parameters: inputParameters, ...scenarioInput } = input;
      const parameters = inputParameters === null ? Prisma.DbNull : inputParameters;
      const row = await transaction.scenario.create({
        data: { ...scenarioInput, parameters },
      });
      const scenario = scenarioSchema.parse(row);
      await transaction.scenarioVersion.create({
        data: {
          scenarioId: scenario.id,
          projectId: scenario.projectId,
          version: 1,
          authorId: actor.userId,
          authorLabel: actor.label,
          changeDescription: "Created",
          snapshot: buildSnapshotEnvelope(snapshotFieldsOf(scenario), []),
          schemaVersion: scenarioSnapshotSchemaVersion,
        },
      });
      if (input.testSuiteId) {
        await this.reconcileLockedTestSuite(transaction, input.projectId, input.testSuiteId);
      }
      return scenario;
    });
  }

  async findById(input: ScenarioIdentity): Promise<Scenario> {
    const row = await this.database.scenario.findFirst({
      where: scenarioWhere(input, false),
    });
    if (!row) {
      throw new ScenarioNotFoundError(input.id);
    }

    return scenarioSchema.parse(row);
  }

  async tryFindById(input: ScenarioIdentity): Promise<Scenario | null> {
    const row = await this.database.scenario.findFirst({
      where: scenarioWhere(input, false),
    });
    return row ? scenarioSchema.parse(row) : null;
  }

  async findByIdIncludingArchived(input: ScenarioIdentity): Promise<Scenario> {
    const row = await this.database.scenario.findFirst({
      where: scenarioWhere(input, true),
    });
    if (!row) {
      throw new ScenarioNotFoundError(input.id);
    }

    return scenarioSchema.parse(row);
  }

  async tryFindByIdIncludingArchived(input: ScenarioIdentity): Promise<Scenario | null> {
    const row = await this.database.scenario.findFirst({
      where: scenarioWhere(input, true),
    });
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

  async update(input: ScenarioWriteInput): Promise<Scenario> {
    return this.database.$transaction(async (transaction) => {
      const current = await this.lockActiveScenario(transaction, input);
      this.assertExpectedVersion(input, current);

      const touchedTestSuiteIds = await this.lockTouchedTestSuites(transaction, input, current);
      const versioned = touchesVersionedFields(input);
      const updated = await this.persistUpdate(transaction, input, current, versioned);

      if (versioned) {
        await this.appendVersion(transaction, input, current, updated);
      }

      if (input.testSuiteId !== void 0) {
        await this.reconcileLockedTestSuites(transaction, input.projectId, touchedTestSuiteIds);
      }

      return updated;
    });
  }

  async findVersions(
    input: ScenarioVersionListInput & { take: number },
  ): Promise<ScenarioVersionSummary[]> {
    const rows = await this.database.scenarioVersion.findMany({
      where: {
        projectId: input.projectId,
        scenarioId: input.scenarioId,
        ...(input.cursor === void 0 ? {} : { version: { lt: input.cursor } }),
      },
      orderBy: { version: "desc" },
      take: input.take,
    });
    return rows.map(mapVersionSummary);
  }

  async findVersion(input: ScenarioVersionInput): Promise<ScenarioVersionDetail> {
    const row = await this.database.scenarioVersion.findFirst({ where: input });
    if (!row) {
      throw new ScenarioVersionNotFoundError(input.scenarioId, input.version);
    }

    const envelope = parseSnapshotEnvelope(row.snapshot);
    return {
      ...mapVersionSummary(row),
      fields: envelope.fields,
      schemaVersion: row.schemaVersion,
    };
  }

  async restoreVersion(input: ScenarioVersionRestoreInput): Promise<Scenario> {
    const scenario = await this.findById({
      id: input.scenarioId,
      projectId: input.projectId,
    });

    const version = await this.findVersion({
      projectId: input.projectId,
      scenarioId: input.scenarioId,
      version: input.version,
    });
    return this.update({
      id: input.scenarioId,
      projectId: input.projectId,
      name: version.fields.name,
      situation: version.fields.situation,
      criteria: version.fields.criteria,
      labels: version.fields.labels,
      parameters: version.fields.parameters,
      simulatorModel: version.fields.simulatorModel,
      judgeModel: version.fields.judgeModel,
      maxTurns: version.fields.maxTurns,
      minTurns: version.fields.minTurns,
      lastUpdatedById: input.actor.userId,
      actor: input.actor,
      expectedVersion: scenario.version,
      changeDescription: `Restored from v${input.version}`,
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

      const testSuites = await this.lockTestSuites(transaction, input.projectId, [
        found.testSuiteId,
      ]);

      const row = await transaction.scenario.update({
        where: { id: input.id, projectId: input.projectId },
        data: { archivedAt: input.archivedAt },
      });
      const testSuite = found.testSuiteId ? testSuites.get(found.testSuiteId) : void 0;
      if (found.testSuiteId && testSuite?.kind === "test_suite" && testSuite.archivedAt === null) {
        await this.reconcileLockedTestSuite(transaction, input.projectId, found.testSuiteId);
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

      const testSuiteIds = activeRows.map((row) => row.testSuiteId);
      await this.lockTestSuites(transaction, input.projectId, testSuiteIds);

      await transaction.scenario.updateMany({
        where: {
          id: { in: activeRows.map((row) => row.id) },
          projectId: input.projectId,
          archivedAt: null,
        },
        data: { archivedAt: input.archivedAt },
      });
      await this.reconcileLockedTestSuites(transaction, input.projectId, testSuiteIds);
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

  async createTestSuite(
    input: ScenarioTestSuiteCreateInput & { id: string },
  ): Promise<ScenarioTestSuite> {
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
            kind: "test_suite",
            scenarioIds: [],
            targets: [],
            repeatCount: 1,
            labels: [],
          },
        });
        return mapTestSuite(row);
      } catch (error) {
        if (!this.isSlugConflict(error)) throw error;
      }
    }
    throw new ScenarioTestSuiteSlugUnavailableError(input.name);
  }

  async findTestSuites(input: { projectId: string }): Promise<ScenarioTestSuite[]> {
    const rows = await this.database.simulationSuite.findMany({
      where: { projectId: input.projectId, kind: "test_suite", archivedAt: null },
      orderBy: { updatedAt: "desc" },
    });
    return rows.map(mapTestSuite);
  }

  async tryFindTestSuite(input: ScenarioTestSuiteIdInput): Promise<ScenarioTestSuite | null> {
    const row = await this.database.simulationSuite.findFirst({
      where: {
        id: input.testSuiteId,
        projectId: input.projectId,
        kind: "test_suite",
        archivedAt: null,
      },
    });
    return row ? mapTestSuite(row) : null;
  }

  async renameTestSuite(input: ScenarioTestSuiteRenameInput): Promise<ScenarioTestSuite> {
    return this.database.$transaction(async (transaction) => {
      const testSuites = await this.lockTestSuites(transaction, input.projectId, [
        input.testSuiteId,
      ]);
      this.assertAssignableTestSuite(input.testSuiteId, testSuites.get(input.testSuiteId));

      const row = await transaction.simulationSuite.update({
        where: { id: input.testSuiteId, projectId: input.projectId },
        data: { name: input.name },
      });
      return mapTestSuite(row);
    });
  }

  async updateTestSuite(input: ScenarioTestSuiteUpdateInput): Promise<ScenarioTestSuite> {
    const { testSuiteId, projectId, targets, ...data } = input;
    const found = await this.database.simulationSuite.findFirst({
      where: { id: testSuiteId, projectId, kind: "test_suite", archivedAt: null },
      select: { id: true },
    });
    if (!found) throw new ScenarioTestSuiteNotFoundError(testSuiteId);

    const row = await this.database.simulationSuite.update({
      where: { id: testSuiteId, projectId },
      data: {
        ...data,
        ...(targets === void 0 ? {} : { targets: targets as Prisma.InputJsonValue }),
      },
    });
    return mapTestSuite(row);
  }

  async getTestSuiteRunDefinition(
    input: ScenarioTestSuiteIdInput,
  ): Promise<ScenarioTestSuiteRunDefinition> {
    return this.database.$transaction(async (transaction) => {
      const testSuite = await transaction.simulationSuite.findFirst({
        where: {
          id: input.testSuiteId,
          projectId: input.projectId,
          kind: "test_suite",
          archivedAt: null,
        },
      });
      if (!testSuite) throw new ScenarioTestSuiteNotFoundError(input.testSuiteId);

      const scenarios = await transaction.scenario.findMany({
        where: { projectId: input.projectId, testSuiteId: input.testSuiteId },
        select: { id: true },
        orderBy: { createdAt: "asc" },
      });
      return {
        testSuite: mapTestSuite(testSuite),
        scenarioIds: scenarios.map((scenario) => scenario.id),
      };
    });
  }

  async archiveTestSuite(
    input: ScenarioTestSuiteIdInput & { archivedAt: Date },
  ): Promise<ScenarioTestSuite> {
    return this.database.$transaction(async (transaction) => {
      const memberRows = await transaction.scenario.findMany({
        where: { projectId: input.projectId, testSuiteId: input.testSuiteId },
        select: { id: true },
      });
      await this.lockScenarios(
        transaction,
        input.projectId,
        memberRows.map((row) => row.id),
      );
      const testSuites = await this.lockTestSuites(transaction, input.projectId, [
        input.testSuiteId,
      ]);
      const testSuite = testSuites.get(input.testSuiteId);
      if (!testSuite || testSuite.kind !== "test_suite") {
        throw new ScenarioTestSuiteNotFoundError(input.testSuiteId);
      }
      if (testSuite.archivedAt) return mapTestSuite(testSuite);

      await transaction.scenario.updateMany({
        where: { projectId: input.projectId, testSuiteId: input.testSuiteId, archivedAt: null },
        data: { archivedAt: input.archivedAt },
      });
      const archivedSlug = testSuite.slug.endsWith("--archived")
        ? testSuite.slug
        : `${testSuite.slug}--archived-${testSuite.id.slice(-6)}`;
      const row = await transaction.simulationSuite.update({
        where: { id: input.testSuiteId, projectId: input.projectId },
        data: { archivedAt: input.archivedAt, slug: archivedSlug },
      });
      return mapTestSuite(row);
    });
  }

  private async lockActiveScenario(
    transaction: Prisma.TransactionClient,
    input: Pick<ScenarioWriteInput, "id" | "projectId">,
  ): Promise<Scenario> {
    const row = await this.lockScenario(transaction, input.projectId, input.id);
    if (!row || row.archivedAt) {
      throw new ScenarioNotFoundError(input.id);
    }

    return scenarioSchema.parse(row);
  }

  private assertExpectedVersion(input: ScenarioWriteInput, current: Scenario): void {
    const expected = input.expectedVersion;
    if (expected !== void 0 && expected !== current.version) {
      throw new ScenarioStaleVersionError(current.version);
    }
  }

  private async lockTouchedTestSuites(
    transaction: Prisma.TransactionClient,
    input: ScenarioWriteInput,
    current: Scenario,
  ): Promise<Array<string | null | undefined>> {
    const touched = input.testSuiteId === void 0 ? [] : [current.testSuiteId, input.testSuiteId];
    const testSuites = await this.lockTestSuites(transaction, input.projectId, touched);
    const targetTestSuiteId = input.testSuiteId;
    if (targetTestSuiteId !== void 0 && targetTestSuiteId !== null) {
      this.assertAssignableTestSuite(targetTestSuiteId, testSuites.get(targetTestSuiteId));
    }

    return touched;
  }

  private async persistUpdate(
    transaction: Prisma.TransactionClient,
    input: ScenarioWriteInput,
    current: Scenario,
    versioned: boolean,
  ): Promise<Scenario> {
    const {
      actor: _actor,
      changeDescription: _changeDescription,
      expectedVersion,
      id,
      parameters: inputParameters,
      projectId,
      ...scenarioData
    } = input;
    const parameters = inputParameters === null ? Prisma.DbNull : inputParameters;
    const data: Prisma.ScenarioUncheckedUpdateInput = {
      ...scenarioData,
      ...(inputParameters === void 0 ? {} : { parameters }),
      ...(versioned
        ? { version: expectedVersion === void 0 ? { increment: 1 } : expectedVersion + 1 }
        : {}),
    };

    try {
      const row = await transaction.scenario.update({
        where: {
          id,
          projectId,
          archivedAt: null,
          ...(expectedVersion === void 0 ? {} : { version: expectedVersion }),
        },
        data,
      });
      return scenarioSchema.parse(row);
    } catch (error) {
      if (expectedVersion !== void 0 && this.isRecordNotFound(error)) {
        throw new ScenarioStaleVersionError(current.version);
      }
      throw error;
    }
  }

  private async appendVersion(
    transaction: Prisma.TransactionClient,
    input: ScenarioWriteInput,
    current: Scenario,
    updated: Scenario,
  ): Promise<void> {
    const previousFields = snapshotFieldsOf(current);
    const updatedFields = snapshotFieldsOf(updated);
    await transaction.scenarioVersion.create({
      data: {
        scenarioId: updated.id,
        projectId: updated.projectId,
        version: updated.version,
        authorId: input.actor.userId,
        authorLabel: input.actor.label,
        changeDescription: input.changeDescription ?? null,
        snapshot: buildSnapshotEnvelope(
          updatedFields,
          changedSnapshotFields(previousFields, updatedFields),
        ),
        schemaVersion: scenarioSnapshotSchemaVersion,
      },
    });
  }

  private assertAssignableTestSuite(
    testSuiteId: string,
    testSuite: SimulationSuite | undefined,
  ): void {
    if (!testSuite || testSuite.kind !== "test_suite" || testSuite.archivedAt !== null) {
      throw new ScenarioTestSuiteNotFoundError(testSuiteId);
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

  private async lockTestSuites(
    transaction: Prisma.TransactionClient,
    projectId: string,
    testSuiteIds: Array<string | null | undefined>,
  ): Promise<Map<string, SimulationSuite>> {
    const ids = [
      ...new Set(
        testSuiteIds.filter(
          (testSuiteId): testSuiteId is string => typeof testSuiteId === "string",
        ),
      ),
    ].sort();
    const testSuites = new Map<string, SimulationSuite>();
    for (const testSuiteId of ids) {
      await transaction.$executeRaw`
        SELECT id
        FROM "SimulationSuite"
        WHERE id = ${testSuiteId} AND "projectId" = ${projectId}
        FOR UPDATE
      `;
      const testSuite = await transaction.simulationSuite.findFirst({
        where: { id: testSuiteId, projectId },
      });
      if (testSuite) testSuites.set(testSuiteId, testSuite);
    }
    return testSuites;
  }

  private async reconcileLockedTestSuites(
    transaction: Prisma.TransactionClient,
    projectId: string,
    testSuiteIds: Array<string | null | undefined>,
  ): Promise<void> {
    const ids = [
      ...new Set(
        testSuiteIds.filter(
          (testSuiteId): testSuiteId is string => typeof testSuiteId === "string",
        ),
      ),
    ].sort();
    for (const testSuiteId of ids) {
      await this.reconcileLockedTestSuite(transaction, projectId, testSuiteId);
    }
  }

  private async reconcileLockedTestSuite(
    transaction: Prisma.TransactionClient,
    projectId: string,
    testSuiteId: string,
  ): Promise<void> {
    const members = await transaction.scenario.findMany({
      where: { projectId, testSuiteId, archivedAt: null },
      select: { id: true },
      orderBy: { createdAt: "asc" },
    });
    await transaction.simulationSuite.update({
      where: { id: testSuiteId, projectId },
      data: { scenarioIds: members.map((member) => member.id) },
    });
  }

  private isSlugConflict(error: unknown): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2002";
  }

  private isRecordNotFound(error: unknown): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === "P2025";
  }
}
