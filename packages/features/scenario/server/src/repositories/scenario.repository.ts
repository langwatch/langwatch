import type {
  Scenario,
  ScenarioCreateInput,
  ScenarioReferenceState,
  ScenarioRunConfig,
  ScenarioUpdateInput,
} from "@langwatch/scenario-contract";

export abstract class ScenarioRepository {
  abstract create(input: ScenarioCreateInput & { id: string }): Promise<Scenario>;
  abstract tryFindById(input: {
    id: string;
    projectId: string;
  }): Promise<Scenario | null>;
  abstract tryFindByIdIncludingArchived(input: {
    id: string;
    projectId: string;
  }): Promise<Scenario | null>;
  abstract findAll(input: { projectId: string }): Promise<Scenario[]>;
  abstract update(input: ScenarioUpdateInput): Promise<Scenario>;
  abstract tryArchive(input: {
    id: string;
    projectId: string;
    archivedAt: Date;
  }): Promise<Scenario | null>;
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
}
