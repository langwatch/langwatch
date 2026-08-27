import type {
  Scenario,
  ScenarioCreateInput,
  ScenarioFolder,
  ScenarioFolderCreateInput,
  ScenarioFolderIdInput,
  ScenarioFolderRenameInput,
  ScenarioFolderRunDefinition,
  ScenarioFolderUpdateInput,
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
  abstract createFolder(input: ScenarioFolderCreateInput & { id: string }): Promise<ScenarioFolder>;
  abstract tryFindFolder(input: ScenarioFolderIdInput): Promise<ScenarioFolder | null>;
  abstract findFolders(input: { projectId: string }): Promise<ScenarioFolder[]>;
  abstract renameFolder(input: ScenarioFolderRenameInput): Promise<ScenarioFolder>;
  abstract updateFolder(input: ScenarioFolderUpdateInput): Promise<ScenarioFolder>;
  abstract getFolderRunDefinition(
    input: ScenarioFolderIdInput,
  ): Promise<ScenarioFolderRunDefinition>;
  abstract archiveFolder(
    input: ScenarioFolderIdInput & { archivedAt: Date },
  ): Promise<ScenarioFolder>;
}
