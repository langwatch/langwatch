import type {
  Experiment,
  ExperimentLookup,
  ExperimentPage,
  ExperimentPageInput,
  ExperimentSlugLookup,
  ExperimentType,
  FindOrCreateWorkflowExperimentInput,
  SaveExperimentInput,
} from "./experiment";

export abstract class ExperimentService {
  abstract getById(input: ExperimentLookup): Promise<Experiment>;
  abstract getBySlug(input: ExperimentSlugLookup): Promise<Experiment>;
  abstract tryGetById(input: ExperimentLookup): Promise<Experiment | null>;
  abstract tryGetBySlug(input: ExperimentSlugLookup): Promise<Experiment | null>;
  abstract tryGetBySlugAndType(
    input: ExperimentSlugLookup & { type: ExperimentType },
  ): Promise<Experiment | null>;
  abstract list(input: { projectId: string }): Promise<Experiment[]>;
  abstract getPage(input: ExperimentPageInput): Promise<ExperimentPage>;
  abstract tryGetLatest(input: { projectId: string }): Promise<Experiment | null>;
  abstract tryGetIdBySlug(
    input: ExperimentSlugLookup,
  ): Promise<{ id: string; slug: string } | null>;
  abstract isActive(input: ExperimentLookup): Promise<boolean>;
  abstract save(input: SaveExperimentInput): Promise<Experiment>;
  abstract findOrCreateForWorkflow(
    input: FindOrCreateWorkflowExperimentInput,
  ): Promise<{ id: string; slug: string }>;
  abstract findNextDraftName(input: { projectId: string }): Promise<string>;
  abstract archive(input: ExperimentLookup): Promise<{ success: true }>;
}
