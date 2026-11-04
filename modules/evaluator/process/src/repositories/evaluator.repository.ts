import type {
  Evaluator,
  EvaluatorConfig,
  EvaluatorCopy,
  EvaluatorUpdateInput,
  EvaluatorVersionAuthorKind,
  EvaluatorWriteAuthor,
} from "@langwatch/evaluator-contract";
import type { Instant } from "@langwatch/time";

/** One evaluator row as it is written; the slug is derived when omitted. */
export type PersistEvaluatorInput = {
  id: string;
  projectId: string;
  name: string;
  slug?: string;
  type: Evaluator["type"];
  config: EvaluatorConfig;
  workflowId?: string;
  copiedFromEvaluatorId?: string;
  /** Authors version 1 and is recorded as the creator. */
  author?: EvaluatorWriteAuthor;
};

/** An update as the repository writes it, with the author of the version it appends. */
export type UpdatePersistedEvaluatorInput = Pick<
  EvaluatorUpdateInput,
  "id" | "projectId" | "data"
> & {
  commitMessage?: string;
  author?: EvaluatorWriteAuthor;
};

/** One immutable version row; the evaluator row itself stays the latest. */
export type EvaluatorVersionRecord = {
  id: string;
  evaluatorId: string;
  projectId: string;
  version: number;
  name: string;
  type: Evaluator["type"];
  config: Record<string, unknown>;
  workflowId: string | null;
  commitMessage: string | null;
  authorId: string | null;
  authorKind: EvaluatorVersionAuthorKind | null;
  createdAt: Instant;
};

export type EvaluatorLabelRecord = {
  evaluatorId: string;
  label: string;
  versionId: string;
  version: number;
  updatedAt: Instant;
  updatedById: string | null;
};

export type EvaluatorVersionLookup = {
  projectId: string;
  evaluatorId: string;
  version?: number;
  versionId?: string;
};

export type EvaluatorIdsInput = { projectId: string; ids: string[] };

/** The evaluator rows a project owns. Absence is an answer, never a refusal. */
export interface EvaluatorRepository {
  findById(input: { id: string; projectId: string }): Promise<Evaluator | undefined>;
  /**
   * One evaluator by id alone. Reading a copy's source crosses the project
   * boundary on purpose: the source lives in the project it was copied from.
   */
  findByIdAcrossProjects(id: string): Promise<Evaluator | undefined>;
  findBySlug(input: { slug: string; projectId: string }): Promise<Evaluator | undefined>;
  findByWorkflow(input: { workflowId: string; projectId: string }): Promise<Evaluator | undefined>;
  /** The public address: the id, and failing that the project-unique slug. */
  findByIdOrSlug(input: { idOrSlug: string; projectId: string }): Promise<Evaluator | undefined>;
  findAll(input: { projectId: string }): Promise<Evaluator[]>;
  /** Active evaluators across the projects, which the cloud Free evaluator cap counts. */
  countActiveByProjects(input: { projectIds: string[] }): Promise<number>;
  findCopies(input: { evaluatorId: string }): Promise<EvaluatorCopy[]>;
  create(input: PersistEvaluatorInput): Promise<Evaluator>;
  /** Appends a version when the name, type, config or workflow changed; else writes none. */
  update(input: UpdatePersistedEvaluatorInput): Promise<Evaluator>;
  archive(input: { id: string; projectId: string }): Promise<Evaluator>;
  updateNameAndConfig(input: {
    id: string;
    projectId: string;
    name: string;
    config: EvaluatorConfig;
    commitMessage?: string;
  }): Promise<void>;
  findVersions(input: {
    projectId: string;
    evaluatorId: string;
  }): Promise<EvaluatorVersionRecord[]>;
  findVersion(input: EvaluatorVersionLookup): Promise<EvaluatorVersionRecord | undefined>;
  latestVersionNumbers(input: EvaluatorIdsInput): Promise<Map<string, number>>;
  findLabels(input: EvaluatorIdsInput): Promise<EvaluatorLabelRecord[]>;
  assignLabel(input: {
    projectId: string;
    evaluatorId: string;
    label: string;
    versionId: string;
    actorId: string | null;
  }): Promise<EvaluatorLabelRecord>;
  removeLabel(input: { projectId: string; evaluatorId: string; label: string }): Promise<boolean>;
  /** A page of every unarchived evaluator, by id, across projects: the backfill's input. */
  findUnversioned(input: { afterId: string | null; limit: number }): Promise<Evaluator[]>;
  /** Writes version 1 from the row as it stands; false when it already has a version. */
  backfillFirstVersion(input: {
    evaluator: Evaluator;
    createdById: string | null;
  }): Promise<boolean>;
}
