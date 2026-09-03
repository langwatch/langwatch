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
  abstract createTestSuite(
    input: ScenarioTestSuiteCreateInput & { id: string },
  ): Promise<ScenarioTestSuite>;
  abstract tryFindTestSuite(input: ScenarioTestSuiteIdInput): Promise<ScenarioTestSuite | null>;
  abstract findTestSuites(input: { projectId: string }): Promise<ScenarioTestSuite[]>;
  abstract renameTestSuite(input: ScenarioTestSuiteRenameInput): Promise<ScenarioTestSuite>;
  abstract updateTestSuite(input: ScenarioTestSuiteUpdateInput): Promise<ScenarioTestSuite>;
  abstract getTestSuiteRunDefinition(
    input: ScenarioTestSuiteIdInput,
  ): Promise<ScenarioTestSuiteRunDefinition>;
  abstract archiveTestSuite(
    input: ScenarioTestSuiteIdInput & { archivedAt: Date },
  ): Promise<ScenarioTestSuite>;
}
