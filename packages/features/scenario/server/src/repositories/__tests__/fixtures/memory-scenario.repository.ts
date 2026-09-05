/**
 * In-memory `ScenarioRepository` double, shared across the package's own
 * tests that need a working `ScenarioService` without a real database.
 */
import {
  ScenarioNotFoundError,
  ScenarioTestSuiteNotFoundError,
  type Scenario,
  type ScenarioActor,
  type ScenarioCreateInput,
  type ScenarioReferenceState,
  type ScenarioRunConfig,
  type ScenarioTestSuite,
  type ScenarioTestSuiteCreateInput,
  type ScenarioTestSuiteIdInput,
  type ScenarioTestSuiteRenameInput,
  type ScenarioTestSuiteRunDefinition,
  type ScenarioTestSuiteUpdateInput,
  type ScenarioUpdateInput,
  type ScenarioVersionDetail,
  type ScenarioVersionInput,
  type ScenarioVersionListInput,
  type ScenarioVersionRestoreInput,
  type ScenarioVersionSummary,
} from "@langwatch/scenario-contract";
import { ScenarioRepository, type ScenarioPlanRecord } from "../../scenario.repository";

export class MemoryScenarioRepository extends ScenarioRepository {
  static create(): MemoryScenarioRepository {
    return new MemoryScenarioRepository();
  }

  readonly rows = new Map<string, Scenario>();
  readonly testSuites = new Map<string, ScenarioTestSuite>();

  async create(
    input: ScenarioCreateInput & { id: string; actor: ScenarioActor },
  ): Promise<Scenario> {
    const { actor: _, ...scenarioInput } = input;
    const row: Scenario = {
      ...scenarioInput,
      parameters: scenarioInput.parameters ?? null,
      simulatorModel: scenarioInput.simulatorModel ?? null,
      judgeModel: scenarioInput.judgeModel ?? null,
      maxTurns: scenarioInput.maxTurns ?? null,
      minTurns: scenarioInput.minTurns ?? null,
      testSuiteId: scenarioInput.testSuiteId ?? null,
      version: 1,
      lastUpdatedById: scenarioInput.lastUpdatedById ?? null,
      archivedAt: null,
      createdAt: new Date(0),
      updatedAt: new Date(0),
    };
    this.rows.set(row.id, row);
    return row;
  }

  tryFindById(input: { id: string; projectId: string }): Promise<Scenario | null> {
    const row = this.rows.get(input.id);
    return Promise.resolve(
      row?.projectId === input.projectId && row.archivedAt === null ? row : null,
    );
  }

  async findById(input: { id: string; projectId: string }): Promise<Scenario> {
    const row = this.rows.get(input.id);
    if (row?.projectId !== input.projectId || row.archivedAt !== null) {
      throw new ScenarioNotFoundError(input.id);
    }

    return row;
  }

  async findByIdIncludingArchived(input: { id: string; projectId: string }): Promise<Scenario> {
    const row = this.rows.get(input.id);
    if (row?.projectId !== input.projectId) {
      throw new ScenarioNotFoundError(input.id);
    }

    return row;
  }

  tryFindByIdIncludingArchived(input: { id: string; projectId: string }): Promise<Scenario | null> {
    const row = this.rows.get(input.id);
    return Promise.resolve(row?.projectId === input.projectId ? row : null);
  }

  findAll(input: { projectId: string }): Promise<Scenario[]> {
    return Promise.resolve(
      [...this.rows.values()].filter(
        (row) => row.projectId === input.projectId && row.archivedAt === null,
      ),
    );
  }

  async count(input: { projectId: string }): Promise<number> {
    return (await this.findAll(input)).length;
  }

  async update(input: ScenarioUpdateInput & { actor: ScenarioActor }): Promise<Scenario> {
    const existing = await this.tryFindByIdIncludingArchived(input);
    if (!existing) throw new ScenarioNotFoundError(input.id);
    const {
      actor: _,
      changeDescription: __,
      expectedVersion: ___,
      id: ____,
      projectId: _____,
      ...data
    } = input;
    const row = { ...existing, ...data, updatedAt: new Date(1) };
    this.rows.set(row.id, row);
    return row;
  }

  findVersions(
    _input: ScenarioVersionListInput & { take: number },
  ): Promise<ScenarioVersionSummary[]> {
    throw new Error("Version history is not exercised by this repository double");
  }

  findVersion(_input: ScenarioVersionInput): Promise<ScenarioVersionDetail> {
    throw new Error("Version history is not exercised by this repository double");
  }

  restoreVersion(_input: ScenarioVersionRestoreInput): Promise<Scenario> {
    throw new Error("Version history is not exercised by this repository double");
  }

  async tryArchive(input: {
    id: string;
    projectId: string;
    archivedAt: Date;
  }): Promise<Scenario | null> {
    const existing = await this.tryFindByIdIncludingArchived(input);
    if (!existing) return null;
    const row = { ...existing, archivedAt: existing.archivedAt ?? input.archivedAt };
    this.rows.set(row.id, row);
    return row;
  }

  async archiveMany(input: {
    ids: string[];
    projectId: string;
    archivedAt: Date;
  }): Promise<{ archived: string[]; missing: string[] }> {
    const archived: string[] = [];
    const missing: string[] = [];
    for (const id of input.ids) {
      const row = await this.tryArchive({
        id,
        projectId: input.projectId,
        archivedAt: input.archivedAt,
      });
      if (row) archived.push(id);
      else missing.push(id);
    }
    return { archived, missing };
  }

  async findRunConfigs(input: { ids: string[]; projectId: string }): Promise<ScenarioRunConfig[]> {
    return [...this.rows.values()]
      .filter((row) => input.ids.includes(row.id) && row.projectId === input.projectId)
      .map(({ id, name, version, situation, criteria, parameters }) => ({
        id,
        name,
        version,
        situation,
        criteria,
        parameters,
      }));
  }

  async findReferenceStates(input: {
    ids: string[];
    projectId: string;
  }): Promise<ScenarioReferenceState[]> {
    return [...this.rows.values()]
      .filter((row) => input.ids.includes(row.id) && row.projectId === input.projectId)
      .map(({ id, archivedAt }) => ({ id, archivedAt }));
  }

  async findNamesByIds(input: {
    ids: string[];
    projectId: string;
  }): Promise<{ id: string; name: string }[]> {
    return [...this.rows.values()]
      .filter((row) => input.ids.includes(row.id) && row.projectId === input.projectId)
      .map(({ id, name }) => ({ id, name }));
  }

  async findModelChoices(input: {
    ids: string[];
    projectId: string;
  }): Promise<{ id: string; simulatorModel: string | null; judgeModel: string | null }[]> {
    return [...this.rows.values()]
      .filter((row) => input.ids.includes(row.id) && row.projectId === input.projectId)
      .map(({ id, simulatorModel, judgeModel }) => ({ id, simulatorModel, judgeModel }));
  }

  async findIdsByLabelsOrTestSuites(input: {
    projectId: string;
    labels?: string[];
    testSuiteIds?: string[];
  }): Promise<string[]> {
    const labels = input.labels ?? [];
    const testSuiteIds = input.testSuiteIds ?? [];
    return [...this.rows.values()]
      .filter(
        (row) =>
          row.projectId === input.projectId &&
          (row.labels.some((label) => labels.includes(label)) ||
            (row.testSuiteId !== null && testSuiteIds.includes(row.testSuiteId))),
      )
      .map((row) => row.id);
  }

  async findTitlesByIds(input: {
    ids: string[];
    projectId: string;
  }): Promise<{ id: string; name: string; labels: string[] }[]> {
    return [...this.rows.values()]
      .filter((row) => input.ids.includes(row.id) && row.projectId === input.projectId)
      .map(({ id, name, labels }) => ({ id, name, labels }));
  }

  async findPlans(): Promise<ScenarioPlanRecord[]> {
    return [];
  }

  async createTestSuite(
    input: ScenarioTestSuiteCreateInput & { id: string },
  ): Promise<ScenarioTestSuite> {
    const testSuite: ScenarioTestSuite = {
      id: input.id,
      projectId: input.projectId,
      name: input.name,
      slug: input.name.toLowerCase(),
      description: null,
      scenarioIds: [],
      targets: [],
      repeatCount: 1,
      labels: [],
      simulatorModel: null,
      judgeModel: null,
      kind: "test_suite",
      scope: null,
      archivedAt: null,
      createdAt: new Date(0),
      updatedAt: new Date(0),
    };
    this.testSuites.set(testSuite.id, testSuite);
    return testSuite;
  }

  findTestSuites(input: { projectId: string }): Promise<ScenarioTestSuite[]> {
    return Promise.resolve(
      [...this.testSuites.values()].filter(
        (testSuite) => testSuite.projectId === input.projectId && testSuite.archivedAt === null,
      ),
    );
  }

  tryFindTestSuite(input: ScenarioTestSuiteIdInput): Promise<ScenarioTestSuite | null> {
    const testSuite = this.testSuites.get(input.testSuiteId);
    return Promise.resolve(
      testSuite?.projectId === input.projectId && testSuite.archivedAt === null ? testSuite : null,
    );
  }

  async renameTestSuite(input: ScenarioTestSuiteRenameInput): Promise<ScenarioTestSuite> {
    return this.updateTestSuite(input);
  }

  async updateTestSuite(input: ScenarioTestSuiteUpdateInput): Promise<ScenarioTestSuite> {
    const testSuite = await this.tryFindTestSuite(input);
    if (!testSuite) throw new ScenarioTestSuiteNotFoundError();

    const { testSuiteId: _, projectId: __, ...changes } = input;
    const updated = { ...testSuite, ...changes, updatedAt: new Date(1) };
    this.testSuites.set(updated.id, updated);
    return updated;
  }

  async getTestSuiteRunDefinition(
    input: ScenarioTestSuiteIdInput,
  ): Promise<ScenarioTestSuiteRunDefinition> {
    const testSuite = await this.tryFindTestSuite(input);
    if (!testSuite) throw new ScenarioTestSuiteNotFoundError();

    return { testSuite, scenarioIds: testSuite.scenarioIds };
  }

  async archiveTestSuite(
    input: ScenarioTestSuiteIdInput & { archivedAt: Date },
  ): Promise<ScenarioTestSuite> {
    const testSuite = this.testSuites.get(input.testSuiteId);
    if (!testSuite || testSuite.projectId !== input.projectId)
      throw new ScenarioTestSuiteNotFoundError();

    const archived = { ...testSuite, archivedAt: testSuite.archivedAt ?? input.archivedAt };
    this.testSuites.set(archived.id, archived);
    return archived;
  }
}
