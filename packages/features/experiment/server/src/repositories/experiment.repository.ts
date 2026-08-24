import type {
  Experiment,
  ExperimentType,
  SaveExperimentInput,
} from "@langwatch/experiment-contract";

export type ExperimentRowState = {
  slug: string;
  workflowId: string | null;
  archived: boolean;
};

export abstract class ExperimentRepository {
  abstract tryFindById(input: {
    id: string;
    projectId: string;
  }): Promise<Experiment | null>;
  abstract tryFindBySlug(input: {
    slug: string;
    projectId: string;
    type?: ExperimentType;
  }): Promise<Experiment | null>;
  abstract findAll(input: { projectId: string }): Promise<Experiment[]>;
  abstract findPage(input: {
    projectId: string;
    skip: number;
    take: number;
  }): Promise<Experiment[]>;
  abstract count(input: { projectId: string }): Promise<number>;
  abstract tryFindLatest(input: {
    projectId: string;
  }): Promise<Experiment | null>;
  abstract tryFindForWorkflow(input: {
    projectId: string;
    workflowId: string;
  }): Promise<Experiment | null>;
  abstract tryFindIdBySlug(input: {
    projectId: string;
    slug: string;
  }): Promise<{ id: string; slug: string } | null>;
  abstract tryGetRowState(input: {
    projectId: string;
    id: string;
  }): Promise<ExperimentRowState | null>;
  abstract findSlugsByPrefix(input: {
    projectId: string;
    slugPrefix: string;
    excludeId?: string;
  }): Promise<string[]>;
  abstract findDraftNames(input: {
    projectId: string;
  }): Promise<Array<{ name: string | null }>>;
  abstract findAllSlugs(input: { projectId: string }): Promise<string[]>;
  abstract saveActive(input: SaveExperimentInput & {
    slug: string;
  }): Promise<Experiment>;
  abstract updateWorkbenchState(input: {
    projectId: string;
    id: string;
    workbenchState: SaveExperimentInput["workbenchState"];
  }): Promise<void>;
  abstract archiveActive(input: {
    projectId: string;
    id: string;
    archivedSlug: string;
    archivedAt: Date;
  }): Promise<boolean>;
}
