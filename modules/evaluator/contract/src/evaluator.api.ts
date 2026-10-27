/**
 * Everything a door may ask about a project's evaluators. Two doors
 * reach it — `evaluators.*` tRPC and `/api/evaluators` REST — so a rule
 * here binds both; callers arrive as `actorId`, never a session.
 */
import { moduleApi } from "@langwatch/module";
import type { Trace } from "@langwatch/trace-contract";

import type { CodeEvaluatorExecutionInput } from "./code-evaluator.ts";
import type { EvaluatorIdOrSlugInput, ResolvedEvaluatorExecution } from "./evaluator-execution.ts";
import type {
  AssignEvaluatorLabelInput,
  EvaluatorCaller,
  EvaluatorLabel,
  EvaluatorVersions,
  EvaluatorVersionSelector,
  RemoveEvaluatorLabelInput,
} from "./evaluator-version.ts";
import type {
  EvaluatorCascadeArchive,
  EvaluatorCopy,
  EvaluatorHistoryEntry,
  EvaluatorPushToCopiesResult,
  EvaluatorRelatedEntities,
  EvaluatorSyncFromSourceResult,
  EvaluatorWorkflowFields,
} from "./evaluator.schemas.ts";
import type { Evaluator, EvaluatorConfig, EvaluatorWithFields } from "./evaluator.ts";
import type { SingleEvaluationResult } from "./evaluators.generated.ts";

/** One evaluator inside one project. */
export type EvaluatorScope = Readonly<{ id: string; projectId: string }>;

/** One evaluator addressed under the field name the lineage procedures publish. */
export type EvaluatorLineageScope = Readonly<{ evaluatorId: string; projectId: string }>;

export type EvaluatorCreateInput = {
  id: string;
  projectId: string;
  name: string;
  slug?: string;
  type: "evaluator" | "code" | "workflow";
  config: EvaluatorConfig;
  workflowId?: string;
  copiedFromEvaluatorId?: string;
  resolved?: { defaultModel?: string | null; embeddingsModel?: string | null };
  /** Authors version 1 and is recorded as the creator. */
  caller?: EvaluatorCaller;
};
export type EvaluatorUpdateInput = {
  id: string;
  projectId: string;
  data: Partial<Pick<Evaluator, "name" | "type" | "workflowId">> & {
    config?: EvaluatorConfig;
  };
  /** Kept on the version this update appends. */
  commitMessage?: string;
  /** Authors the appended version and is recorded as the last updater. */
  caller?: EvaluatorCaller;
};

export type NativeEvaluatorExecutionInput = {
  evaluatorType: string;
  data: Record<string, unknown>;
};

export type EvaluatorResultAugmentationInput = {
  evaluatorType: string;
  mappedData: Record<string, unknown>;
  settings: Record<string, unknown> | undefined;
  droppedCategories: string[];
  result: SingleEvaluationResult;
};

export interface EvaluatorApi {
  /** Runs a code evaluator's program in the process's own code sandbox. */
  executeCode(input: CodeEvaluatorExecutionInput): Promise<SingleEvaluationResult>;
  /** Runs a native evaluator through the NLP engine. */
  executeNative(input: NativeEvaluatorExecutionInput): Promise<SingleEvaluationResult>;
  /** Reshapes a native evaluator's raw result onto mapped data and dropped categories. */
  augmentResult(input: EvaluatorResultAugmentationInput): SingleEvaluationResult;
  /** Resolves an evaluator by id or slug into what running it needs. */
  resolveForExecution(input: EvaluatorIdOrSlugInput): Promise<ResolvedEvaluatorExecution>;

  /** Every evaluator in the project. */
  getAll(input: { projectId: string }): Promise<Evaluator[]>;
  /** Every evaluator in the project, with its computed input and output fields. */
  getAllWithFields(input: { projectId: string }): Promise<EvaluatorWithFields[]>;
  /**
   * One evaluator, at the latest version unless a label or a version is asked for; `id` also
   * takes the `id:label` address. Throws `EvaluatorNotFoundError` when the project has none.
   */
  getById(input: EvaluatorScope & EvaluatorVersionSelector): Promise<Evaluator>;
  /** One evaluator, or `undefined` when the project has none. */
  findById(input: EvaluatorScope): Promise<Evaluator | undefined>;
  /** One evaluator with its computed fields. */
  getByIdWithFields(input: EvaluatorScope): Promise<EvaluatorWithFields>;
  /** One evaluator with its computed fields, or `undefined`. */
  findByIdWithFields(input: EvaluatorScope): Promise<EvaluatorWithFields | undefined>;
  /** One evaluator by its project-unique slug, or `undefined`. */
  findBySlug(input: { slug: string; projectId: string }): Promise<Evaluator | undefined>;
  /** Evaluator by project-unique slug; throws `EvaluatorNotFoundError` if none match. */
  getBySlug(input: { slug: string; projectId: string }): Promise<Evaluator>;
  /** One evaluator the way the public API addresses it: by id, failing that by slug. */
  findByIdOrSlugWithFields(
    input: {
      idOrSlug: string;
      projectId: string;
    } & EvaluatorVersionSelector,
  ): Promise<EvaluatorWithFields | undefined>;
  /** The evaluator already assigned to this workflow, if there is one. */
  listByWorkflow(input: { workflowId: string; projectId: string }): Promise<Evaluator[]>;
  /** The entry-node fields a workflow evaluator maps trace data onto. */
  getWorkflowFields(input: EvaluatorScope): Promise<EvaluatorWorkflowFields>;
  /** The workflow a cascade archive would take with the evaluator. */
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
    caller?: EvaluatorCaller;
  }): Promise<Evaluator>;
  /** Creates an evaluator against models already resolved by the caller. */
  createWithDefaults(input: EvaluatorCreateInput): Promise<Evaluator>;
  /** Updates an evaluator, refusing a code evaluator that carries no program. */
  update(input: EvaluatorUpdateInput): Promise<Evaluator>;
  /** Soft-deletes an evaluator; a labelled one needs `evaluators:deploy` of `caller`. */
  archive(input: EvaluatorScope & { caller?: EvaluatorCaller }): Promise<Evaluator>;
  /** Archives the evaluator and its workflow, and records `lw.evaluator.deleted`. */
  cascadeArchive(
    input: EvaluatorScope & { caller?: EvaluatorCaller },
  ): Promise<EvaluatorCascadeArchive>;
  /** Every version of the evaluator, newest first, with the labels on each. */
  listVersions(input: EvaluatorLineageScope): Promise<EvaluatorVersions>;
  /** Points a deploy label at one of the evaluator's versions. */
  assignLabel(
    input: AssignEvaluatorLabelInput & { caller?: EvaluatorCaller },
  ): Promise<EvaluatorLabel>;
  removeLabel(input: RemoveEvaluatorLabelInput): Promise<void>;
  /** The evaluator at a label, or the latest when the label points nowhere (a monitor's pin). */
  atLabelOrLatest(input: { evaluator: Evaluator; label: string }): Promise<Evaluator>;
  /** Replicates the evaluator, and the workflow backing it, into another project. */
  copy(input: {
    evaluatorId: string;
    projectId: string;
    sourceProjectId: string;
    newEvaluatorId: string;
    actorId: string;
    /**
     * Copying a library evaluator counts against the plan's evaluator cap; an
     * online evaluation's copy brings its evaluator along uncapped, so it passes false.
     */
    shouldCheckEvaluatorCap?: boolean;
  }): Promise<Evaluator>;
  /** Pushes the source evaluator's config onto the replicas the caller may write. */
  pushToCopies(
    input: EvaluatorLineageScope & { copyIds?: string[]; actorId: string },
  ): Promise<EvaluatorPushToCopiesResult>;
  /** Pulls a copy back into line with the evaluator it came from. */
  syncFromSource(
    input: EvaluatorLineageScope & { actorId: string },
  ): Promise<EvaluatorSyncFromSourceResult>;
  /**
   * The platform's own address for one evaluator resource, from the
   * project's slug and an already-resolved path. The REST declaration is
   * static with no request-scoped builder, so the app composes the link.
   */
  platformUrl(input: { projectSlug: string; path: string }): string;
  /**
   * The ids of the traces a check would run on: its required fields present and every
   * precondition passing. `preconditions` is parsed here, as the caller cannot name its schema.
   */
  findTraceIdsPassingPreconditions(input: {
    evaluatorType: string;
    preconditions: unknown;
    traces: readonly Trace[];
  }): Promise<string[]>;
}

export const EvaluatorApi = moduleApi<EvaluatorApi>()("evaluator");
