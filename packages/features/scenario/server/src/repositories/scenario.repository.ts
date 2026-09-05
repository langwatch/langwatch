import type {
  Scenario,
  ScenarioCreateInput,
  ScenarioTestSuite,
  ScenarioTestSuiteCreateInput,
  ScenarioTestSuiteIdInput,
  ScenarioTestSuiteRenameInput,
  ScenarioTestSuiteRunDefinition,
  ScenarioTestSuiteUpdateInput,
  ScenarioReferenceState,
  ScenarioRunConfig,
  ScenarioUpdateInput,
  ScenarioActor,
  ScenarioVersionDetail,
  ScenarioVersionInput,
  ScenarioVersionListInput,
  ScenarioVersionRestoreInput,
  ScenarioVersionSummary,
} from "@langwatch/scenario-contract";

/**
 * One run plan row, read for the results tab and the run-configuration history — a
 * `SimulationSuite` row of any kind, not only `test_suite`.
 */
export interface ScenarioPlanRecord {
  id: string;
  name: string;
  slug: string;
  kind: string;
  scope: unknown;
  scenarioIds: string[];
  targets: unknown;
}

export abstract class ScenarioRepository {
  abstract create(
    input: ScenarioCreateInput & { id: string; actor: ScenarioActor },
  ): Promise<Scenario>;
  abstract findById(input: { id: string; projectId: string }): Promise<Scenario>;
  abstract tryFindById(input: { id: string; projectId: string }): Promise<Scenario | null>;
  abstract findByIdIncludingArchived(input: { id: string; projectId: string }): Promise<Scenario>;
  abstract tryFindByIdIncludingArchived(input: {
    id: string;
    projectId: string;
  }): Promise<Scenario | null>;
  abstract findAll(input: { projectId: string }): Promise<Scenario[]>;
  abstract count(input: { projectId: string }): Promise<number>;
  abstract update(input: ScenarioUpdateInput & { actor: ScenarioActor }): Promise<Scenario>;
  abstract findVersions(
    input: ScenarioVersionListInput & { take: number },
  ): Promise<ScenarioVersionSummary[]>;
  abstract findVersion(input: ScenarioVersionInput): Promise<ScenarioVersionDetail>;
  abstract restoreVersion(input: ScenarioVersionRestoreInput): Promise<Scenario>;
  abstract tryArchive(input: {
    id: string;
    projectId: string;
    archivedAt: Date;
  }): Promise<Scenario | null>;
  abstract archiveMany(input: {
    ids: string[];
    projectId: string;
    archivedAt: Date;
  }): Promise<{ archived: string[]; missing: string[] }>;
  abstract findRunConfigs(input: {
    ids: string[];
    projectId: string;
  }): Promise<ScenarioRunConfig[]>;
  abstract findReferenceStates(input: {
    ids: string[];
    projectId: string;
  }): Promise<ScenarioReferenceState[]>;
  abstract findNamesByIds(input: {
    ids: string[];
    projectId: string;
  }): Promise<{ id: string; name: string }[]>;
  abstract findModelChoices(input: {
    ids: string[];
    projectId: string;
  }): Promise<{ id: string; simulatorModel: string | null; judgeModel: string | null }[]>;
  /** Scenario ids carrying any of these labels, or filed in any of these test suites. */
  abstract findIdsByLabelsOrTestSuites(input: {
    projectId: string;
    labels?: string[];
    testSuiteIds?: string[];
  }): Promise<string[]>;
  /** A scenario's title and labels, for the results tab's scenario grouping. */
  abstract findTitlesByIds(input: {
    ids: string[];
    projectId: string;
  }): Promise<{ id: string; name: string; labels: string[] }[]>;
  /** Every non-archived run plan of the project, every kind. */
  abstract findPlans(input: { projectId: string }): Promise<ScenarioPlanRecord[]>;
  abstract createTestSuite(
    input: ScenarioTestSuiteCreateInput & { id: string },
  ): Promise<ScenarioTestSuite>;
  abstract tryFindTestSuite(input: ScenarioTestSuiteIdInput): Promise<ScenarioTestSuite | null>;
  abstract findTestSuites(input: {
    projectId: string;
    includeArchived?: boolean;
  }): Promise<ScenarioTestSuite[]>;
  abstract renameTestSuite(input: ScenarioTestSuiteRenameInput): Promise<ScenarioTestSuite>;
  abstract updateTestSuite(input: ScenarioTestSuiteUpdateInput): Promise<ScenarioTestSuite>;
  abstract getTestSuiteRunDefinition(
    input: ScenarioTestSuiteIdInput,
  ): Promise<ScenarioTestSuiteRunDefinition>;
  abstract archiveTestSuite(
    input: ScenarioTestSuiteIdInput & { archivedAt: Date },
  ): Promise<ScenarioTestSuite>;

  /**
   * The project's active Default test suite, or null.
   *
   * Matched by name rather than by a reserved label, so a suite a person named
   * "Default" themselves IS the project's Default rather than a second one
   * beside it. The oldest wins when a project holds two.
   */
  abstract tryFindDefaultTestSuite(input: { projectId: string }): Promise<{ id: string } | null>;

  /**
   * Creates the project's Default test suite and answers its id, or answers the
   * id of the one a concurrent write created first. The `default` slug may
   * already belong to another suite of the project, so the slug takes a numeric
   * suffix rather than the write being refused.
   */
  abstract createDefaultTestSuite(input: {
    projectId: string;
    id: string;
  }): Promise<{ id: string }>;
}
