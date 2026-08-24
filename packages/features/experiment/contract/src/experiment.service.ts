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
import type {
  CompleteExperimentRunInput,
  ExperimentRun,
  ExperimentRunAggregate,
  ExperimentRunListInput,
  ExperimentRunLookup,
  ExperimentRunPageInput,
  ExperimentRunSlugPageInput,
  ExperimentRunWithItems,
  RecordEvaluatorResultInput,
  RecordTargetResultInput,
  StartExperimentRunInput,
} from "./experiment-run";

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
  abstract listRuns(input: ExperimentRunListInput): Promise<Record<string, ExperimentRun[]>>;
  abstract getRunAggregates(input: ExperimentRunListInput): Promise<Record<string, ExperimentRunAggregate>>;
  abstract getRunsPage(input: ExperimentRunPageInput): Promise<{ runs: ExperimentRun[]; totalHits: number }>;
  /** A polling read: absent rows and disabled ClickHouse both read as null. */
  abstract tryGetRun(input: ExperimentRunLookup): Promise<ExperimentRunWithItems | null>;
  abstract getRunsPageBySlug(input: ExperimentRunSlugPageInput): Promise<{
    experiment: { id: string; slug: string };
    runs: ExperimentRun[];
    totalHits: number;
  }>;
  abstract startExperimentRun(input: StartExperimentRunInput): Promise<void>;
  abstract recordTargetResult(input: RecordTargetResultInput): Promise<void>;
  abstract recordEvaluatorResult(
    input: RecordEvaluatorResultInput,
  ): Promise<void>;
  abstract completeExperimentRun(
    input: CompleteExperimentRunInput,
  ): Promise<void>;
}
