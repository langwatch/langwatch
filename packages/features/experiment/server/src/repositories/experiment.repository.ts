import type {
  Experiment,
  ExperimentType,
  SaveExperimentInput,
  WorkbenchActor,
  WorkbenchStateView,
  WorkbenchVersionSummary,
} from "@langwatch/experiment-contract";

export type ExperimentRowState = {
  slug: string;
  workflowId: string | null;
  archived: boolean;
};

export type WorkbenchWriteResult =
  | { kind: "saved"; experimentId: string; slug: string; version: number }
  | {
      kind: "stale";
      currentVersion: number;
      actorLabel?: string;
      runId?: string;
    };

export class ArchivedExperimentWriteError extends Error {
  constructor(readonly experimentId: string) {
    super("Archived experiments cannot be changed");
    this.name = "ArchivedExperimentWriteError";
  }
}

export abstract class ExperimentRepository {
  abstract tryFindById(input: { id: string; projectId: string }): Promise<Experiment | null>;
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
  abstract tryFindLatest(input: { projectId: string }): Promise<Experiment | null>;
  abstract tryFindForWorkflow(input: {
    projectId: string;
    workflowId: string;
  }): Promise<Experiment | null>;
  abstract tryFindIdBySlug(input: {
    projectId: string;
    slug: string;
  }): Promise<{ id: string; slug: string } | null>;
  abstract getBySlugOrId(input: { projectId: string; slugOrId: string }): Promise<Experiment>;
  abstract tryGetRowState(input: {
    projectId: string;
    id: string;
  }): Promise<ExperimentRowState | null>;
  abstract findSlugsByPrefix(input: {
    projectId: string;
    slugPrefix: string;
    excludeId?: string;
  }): Promise<string[]>;
  abstract findDraftNames(input: { projectId: string }): Promise<Array<{ name: string | null }>>;
  abstract findAllSlugs(input: { projectId: string }): Promise<string[]>;
  abstract saveActive(
    input: SaveExperimentInput & {
      slug: string;
    },
  ): Promise<Experiment>;
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
  abstract getWorkbenchState(input: {
    projectId: string;
    id?: string;
    slug?: string;
  }): Promise<WorkbenchStateView>;
  abstract resolveWorkbenchSaveTarget(input: {
    projectId: string;
    id?: string;
    slug?: string;
  }): Promise<{ kind: "create"; id?: string } | { kind: "update"; state: WorkbenchStateView }>;
  abstract writeWorkbenchState(input: {
    projectId: string;
    id: string;
    name: string;
    state: unknown;
    snapshot: unknown;
    expectedVersion?: number;
    actor: WorkbenchActor;
    commitMessage?: string;
  }): Promise<WorkbenchWriteResult>;
  abstract createWorkbenchState(input: {
    projectId: string;
    id: string;
    slug: string;
    name: string;
    state: unknown;
    snapshot: unknown;
    actor: WorkbenchActor;
    commitMessage?: string;
  }): Promise<{ id: string; slug: string }>;
  abstract listWorkbenchVersions(input: {
    projectId: string;
    experimentId: string;
    take: number;
    beforeCounterVersion?: number;
  }): Promise<WorkbenchVersionSummary[]>;
  abstract getWorkbenchVersion(input: {
    projectId: string;
    experimentId: string;
    version: number;
  }): Promise<{ autoSaved: boolean; state: unknown }>;
}
