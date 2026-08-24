import type {
  Scenario,
  ScenarioCreateInput,
  ScenarioIdInput,
  ScenarioReferenceState,
  ScenarioRunConfig,
  ScenarioUpdateInput,
} from "./scenario";

export abstract class ScenarioService {
  abstract create(input: ScenarioCreateInput): Promise<Scenario>;
  abstract getById(input: ScenarioIdInput): Promise<Scenario>;
  abstract tryGetById(input: ScenarioIdInput): Promise<Scenario | null>;
  abstract tryGetByIdIncludingArchived(
    input: ScenarioIdInput,
  ): Promise<Scenario | null>;
  abstract list(input: { projectId: string }): Promise<Scenario[]>;
  abstract update(input: ScenarioUpdateInput): Promise<Scenario>;
  abstract archive(input: ScenarioIdInput): Promise<Scenario>;
  abstract batchArchive(input: {
    ids: string[];
    projectId: string;
  }): Promise<{ archived: string[]; failed: { id: string; error: string }[] }>;
  abstract getRunConfigs(input: {
    ids: string[];
    projectId: string;
  }): Promise<ScenarioRunConfig[]>;
  abstract getReferenceStates(input: {
    ids: string[];
    projectId: string;
  }): Promise<ScenarioReferenceState[]>;
  abstract getNamesByIds(input: {
    ids: string[];
    projectId: string;
  }): Promise<{ id: string; name: string }[]>;
}
