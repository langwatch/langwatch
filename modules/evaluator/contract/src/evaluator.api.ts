/**
 * Everything a door may ask about a project's evaluators.
 *
 * Two doors ask: the `evaluators.*` tRPC namespace the editor calls, and the
 * `/api/evaluators` REST family. Both reach this one object, so a rule written
 * on it is the rule both doors get, and a caller arrives as an argument —
 * `actorId` — never read from a session or a request.
 */
import { moduleApi } from "@langwatch/runtime-composition";
import type {
  EvaluatorCascadeArchive,
  EvaluatorCopy,
  EvaluatorHistoryEntry,
  EvaluatorPushToCopiesResult,
  EvaluatorRelatedEntities,
  EvaluatorSyncFromSourceResult,
  EvaluatorWorkflowFields,
} from "./evaluator.schemas.ts";
import type { EvaluatorCreateInput, EvaluatorUpdateInput } from "./evaluator.service.ts";
import type { Evaluator, EvaluatorConfig, EvaluatorWithFields } from "./evaluator.ts";

/** One evaluator inside one project. */
export type EvaluatorScope = Readonly<{ id: string; projectId: string }>;

/** One evaluator addressed under the field name the lineage procedures publish. */
export type EvaluatorLineageScope = Readonly<{ evaluatorId: string; projectId: string }>;

export interface EvaluatorApi {
  /** Every evaluator in the project. */
  getAll(input: { projectId: string }): Promise<Evaluator[]>;
  /** Every evaluator in the project, with its computed input and output fields. */
  getAllWithFields(input: { projectId: string }): Promise<EvaluatorWithFields[]>;
  /** One evaluator. Throws `EvaluatorNotFoundError` when the project has none. */
  getById(input: EvaluatorScope): Promise<Evaluator>;
  /** One evaluator, or `undefined` when the project has none. */
  findById(input: EvaluatorScope): Promise<Evaluator | undefined>;
  /** One evaluator with its computed fields. */
  getByIdWithFields(input: EvaluatorScope): Promise<EvaluatorWithFields>;
  /** One evaluator with its computed fields, or `undefined`. */
  findByIdWithFields(input: EvaluatorScope): Promise<EvaluatorWithFields | undefined>;
  /** One evaluator by its project-unique slug, or `undefined`. */
  findBySlug(input: { slug: string; projectId: string }): Promise<Evaluator | undefined>;
  /** One evaluator the way the public API addresses it: by id, failing that by slug. */
  findByIdOrSlugWithFields(input: {
    idOrSlug: string;
    projectId: string;
  }): Promise<EvaluatorWithFields | undefined>;
  /** The evaluator already assigned to this workflow, if there is one. */
  listByWorkflow(input: { workflowId: string; projectId: string }): Promise<Evaluator[]>;
  /** The entry-node fields a workflow evaluator maps trace data onto. */
  getWorkflowFields(input: EvaluatorScope): Promise<EvaluatorWorkflowFields>;
  /** The workflow and monitors a cascade archive would take with the evaluator. */
  getRelatedEntities(input: EvaluatorScope): Promise<EvaluatorRelatedEntities>;
  /** The replicas of this evaluator the caller may read. */
  getCopies(input: EvaluatorLineageScope & { actorId: string }): Promise<EvaluatorCopy[]>;
  /** A copy and the evaluator it was copied from. */
  getCopySource(input: EvaluatorLineageScope): Promise<{ copy: Evaluator; source: Evaluator }>;
  /** Recent audit-log history for one evaluator. */
  getHistory(input: EvaluatorLineageScope): Promise<EvaluatorHistoryEntry[]>;

  /** Creates an evaluator, refusing a code evaluator that carries no program. */
  create(input: EvaluatorCreateInput): Promise<Evaluator>;
  /** Creates an evaluator against the project's resolved default and embeddings models. */
  createWithResolvedDefaults(input: {
    projectId: string;
    name: string;
    config: EvaluatorConfig;
    id?: string;
  }): Promise<Evaluator>;
  /** Updates an evaluator, refusing a code evaluator that carries no program. */
  update(input: EvaluatorUpdateInput): Promise<Evaluator>;
  /** Soft-deletes an evaluator. */
  archive(input: EvaluatorScope): Promise<Evaluator>;
  /** Archives the evaluator, archives its workflow and deletes its monitors. */
  cascadeArchive(input: EvaluatorScope): Promise<EvaluatorCascadeArchive>;
  /** Replicates the evaluator, and the workflow backing it, into another project. */
  copy(input: {
    evaluatorId: string;
    projectId: string;
    sourceProjectId: string;
    newEvaluatorId: string;
    actorId: string;
  }): Promise<Evaluator>;
  /** Pushes the source evaluator's config onto the replicas the caller may write. */
  pushToCopies(
    input: EvaluatorLineageScope & { copyIds?: string[]; actorId: string },
  ): Promise<EvaluatorPushToCopiesResult>;
  /** Pulls a copy back into line with the evaluator it came from. */
  syncFromSource(
    input: EvaluatorLineageScope & { actorId: string },
  ): Promise<EvaluatorSyncFromSourceResult>;
}

export const EvaluatorApi = moduleApi<EvaluatorApi>("evaluator");
