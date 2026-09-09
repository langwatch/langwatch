/**
 * The procedures the Workflows screens call. Segment names are load-bearing -
 * tRPC hashes the path into the cache key. ADR-004's one governed-closure
 * exception here.
 */

import type { AgentApiUpdateOutput, UpdateAgentCommand } from "@langwatch/agent-contract";
import type {
  DatasetApiDatasetInput,
  DatasetApiFindNextNameInput,
  DatasetApiFindNextNameOutput,
  DatasetApiGetAllOutput,
  DatasetApiGetByIdOutput,
  DatasetApiProjectInput,
  DatasetApiUpsertInput,
  DatasetApiUpsertOutput,
  DatasetApiValidateNameInput,
  DatasetApiValidateNameOutput,
} from "@langwatch/dataset-contract";
import type {
  EvaluatorApiCreateInput,
  EvaluatorApiCreateOutput,
  EvaluatorApiDeleteOutput,
  EvaluatorApiEvaluatorIdInput,
  EvaluatorApiGetAllOutput,
  EvaluatorApiGetByIdOutput,
  EvaluatorApiProjectInput,
  EvaluatorApiUpdateInput,
  EvaluatorApiUpdateOutput,
} from "@langwatch/evaluator-contract";
import type {
  ModelDefaultResolvedTrpcOutput,
  ModelProviderListAllForProjectTrpcOutput,
} from "@langwatch/model-provider-contract";
import type {
  PromptAssignTagTrpcInput,
  PromptAssignTagTrpcOutput,
  PromptConfigTagsTrpcInput,
  PromptConfigTagsTrpcOutput,
  PromptCreateTrpcInput,
  PromptCreateTrpcOutput,
  PromptGetAllForProjectTrpcOutput,
  PromptGetAllVersionsTrpcOutput,
  PromptGetByIdOrHandleTrpcInput,
  PromptGetByIdOrHandleTrpcOutput,
  PromptHandleUniquenessTrpcInput,
  PromptHandleUniquenessTrpcOutput,
  PromptIdOrHandleTrpcInput,
  PromptProjectTrpcInput,
  PromptUpdateHandleTrpcInput,
  PromptUpdateHandleTrpcOutput,
  PromptUpdateTrpcInput,
  PromptUpdateTrpcOutput,
} from "@langwatch/prompt-contract";
import type { workflowTrpc, workflowOptimizationTrpc } from "@langwatch/workflow-contract";
import {
  createModuleApi,
  type ContractApiMap,
  type OutputsFromMap,
  type RouterFromMap,
} from "@langwatch/api/web";

/** Where a workflow lives, as the copy lineage tooltip spells it out. */
export type WorkflowProjectPath = {
  id: string;
  name: string;
  team: { id: string; name: string; organization: { id: string; name: string } };
};

/** A listed workflow, narrowed to what the card renders. */
export type WorkflowListRow = {
  id: string;
  projectId: string;
  name: string;
  icon: string | null;
  description: string | null;
  /** ISO 8601: nothing transforms the wire, so the instant arrives as text. */
  updatedAt: string;
  copiedFromWorkflowId: string | null;
  copiedFrom: { id: string; name: string; projectId: string; project: WorkflowProjectPath } | null;
  _count: { copiedWorkflows: number };
};

/**
 * One replica of a workflow, as the push dialog lists it. `fullPath` is
 * composed by the transport, same string the replication picker builds;
 * the list only ever contains replicas the caller may update.
 */
export type WorkflowCopyRow = {
  id: string;
  name: string;
  projectId: string;
  projectName: string;
  teamName: string;
  organizationName: string;
  fullPath: string;
  hasPermission: boolean;
};

/** A related row the delete confirmation names before it is taken. */
export type WorkflowRelatedEntity = { id: string; name: string };

/**
 * What deleting a workflow would take with it, named before the reader types
 * "delete": linked evaluators/agents are archived, every online evaluation
 * built on them is deleted, none recoverable from this screen.
 */
export type WorkflowRelatedEntities = {
  evaluators: WorkflowRelatedEntity[];
  agents: WorkflowRelatedEntity[];
  monitors: WorkflowRelatedEntity[];
};

/** What the cascade actually did, which is what the confirmation reports back. */
export type WorkflowCascadeArchiveResult = {
  archivedEvaluatorsCount: number;
  archivedAgentsCount: number;
  deletedMonitorsCount: number;
};

/** The team graph the replication picker is derived from, as the shell reads it. */
export type WorkflowOrganizationGraph = {
  id: string;
  name: string;
  teams: {
    id: string;
    name: string;
    members?: { userId: string; role: string; assignedRole?: { permissions?: unknown } | null }[];
    projects: { id: string; name: string; slug: string }[];
  }[];
};

/**
 * A procedure the studio calls whose row shape no contract publishes yet.
 * Declared by path only; every `Unpublished` below is owed work, named not hidden.
 */
// oxlint-disable-next-line no-explicit-any
type Unpublished = any;

type UnpublishedQuery = { query: { input: Unpublished; output: Unpublished } };
type UnpublishedMutation = { mutation: { input: Unpublished; output: Unpublished } };
type UnpublishedSubscription = {
  subscription: { input: Unpublished; output: Unpublished };
};

/**
 * Procedures other features own. Each belongs in that feature's own contract;
 * until it is split, this family states the shape it reads.
 */
type BorrowedProcedures = {
  organization: {
    getAll: { query: { input: { isDemo: boolean }; output: WorkflowOrganizationGraph[] } };
  };

  /** Agent mutation borrowed from agent-contract. */
  agents: {
    getAll: UnpublishedQuery;
    getById: UnpublishedQuery;
    update: { mutation: { input: UpdateAgentCommand; output: AgentApiUpdateOutput } };
  };
  batchRecord: { getAllByexperimentSlug: UnpublishedQuery };
  analytics: { dataForFilter: UnpublishedQuery };
  annotationScore: { getAllActive: UnpublishedQuery };
  dataset: {
    getAll: { query: { input: DatasetApiProjectInput; output: DatasetApiGetAllOutput } };
    getById: { query: { input: DatasetApiDatasetInput; output: DatasetApiGetByIdOutput } };
    upsert: { mutation: { input: DatasetApiUpsertInput; output: DatasetApiUpsertOutput } };
    validateDatasetName: {
      query: { input: DatasetApiValidateNameInput; output: DatasetApiValidateNameOutput };
    };
    findNextName: {
      query: { input: DatasetApiFindNextNameInput; output: DatasetApiFindNextNameOutput };
    };
  };
  datasetRecord: {
    create: UnpublishedMutation;
    deleteMany: UnpublishedMutation;
    download: UnpublishedMutation;
    getAll: UnpublishedQuery;
    getHead: UnpublishedQuery;
    listPaginated: UnpublishedQuery;
    update: UnpublishedMutation;
  };
  evaluations: {
    availableCustomEvaluators: UnpublishedQuery;
    availableEvaluators: UnpublishedQuery;
    runEvaluation: UnpublishedMutation;
    warmupLambda: UnpublishedMutation;
  };
  evaluators: {
    getAll: { query: { input: EvaluatorApiProjectInput; output: EvaluatorApiGetAllOutput } };
    create: { mutation: { input: EvaluatorApiCreateInput; output: EvaluatorApiCreateOutput } };
    delete: {
      mutation: { input: EvaluatorApiEvaluatorIdInput; output: EvaluatorApiDeleteOutput };
    };
    getById: {
      query: { input: EvaluatorApiEvaluatorIdInput; output: EvaluatorApiGetByIdOutput };
    };
    update: { mutation: { input: EvaluatorApiUpdateInput; output: EvaluatorApiUpdateOutput } };
  };
  /** Experiments family, longest since experiment-web serves five addresses here. */
  experiments: {
    copy: UnpublishedMutation;
    deleteExperiment: UnpublishedMutation;
    getAllForEvaluationsList: UnpublishedQuery;
    getEvaluationsV3BySlug: UnpublishedQuery;
    getExperimentBatchEvaluationRun: UnpublishedQuery;
    getExperimentBatchEvaluationRuns: UnpublishedQuery;
    getExperimentBySlugOrId: UnpublishedQuery;
    getExperimentDSPyRuns: UnpublishedQuery;
    getExperimentDSPyStep: UnpublishedQuery;
    getWorkbenchVersion: UnpublishedQuery;
    listWorkbenchVersions: UnpublishedQuery;
    onExperimentUpdate: UnpublishedSubscription;
    restoreWorkbenchVersion: UnpublishedMutation;
    saveEvaluationsV3: UnpublishedMutation;
  };
  featureFlag: { isEnabled: UnpublishedQuery };
  httpProxy: { execute: UnpublishedMutation };
  llmModelCost: { tryGetModelLimits: UnpublishedQuery };
  modelProvider: {
    getAllForProject: UnpublishedQuery;
    getAllForProjectForFrontend: UnpublishedQuery;
    getResolvedDefault: {
      query: {
        input: { projectId: string; featureKey: string };
        output: ModelDefaultResolvedTrpcOutput;
      };
    };
    listAllForProjectForFrontend: {
      query: { input: { projectId: string }; output: ModelProviderListAllForProjectTrpcOutput };
    };
  };
  monitors: {
    create: UnpublishedMutation;
    delete: UnpublishedMutation;
    getAllForProject: UnpublishedQuery;
    getById: UnpublishedQuery;
    getPerformanceForProject: UnpublishedQuery;
    isNameAvailable: UnpublishedMutation;
    update: UnpublishedMutation;
  };
  ops: { getScope: UnpublishedQuery };
  project: {
    getFieldRedactionStatus: UnpublishedQuery;
    getProjectAPIKey: UnpublishedQuery;
  };
  promptTags: {
    create: UnpublishedMutation;
    delete: UnpublishedMutation;
    getAll: UnpublishedQuery;
  };
  prompts: {
    assignTag: { mutation: { input: PromptAssignTagTrpcInput; output: PromptAssignTagTrpcOutput } };
    checkHandleUniqueness: {
      query: { input: PromptHandleUniquenessTrpcInput; output: PromptHandleUniquenessTrpcOutput };
    };
    getAllPromptsForProject: {
      query: { input: PromptProjectTrpcInput; output: PromptGetAllForProjectTrpcOutput };
    };
    create: { mutation: { input: PromptCreateTrpcInput; output: PromptCreateTrpcOutput } };
    getAllVersionsForPrompt: {
      query: { input: PromptIdOrHandleTrpcInput; output: PromptGetAllVersionsTrpcOutput };
    };
    getByIdOrHandle: {
      query: { input: PromptGetByIdOrHandleTrpcInput; output: PromptGetByIdOrHandleTrpcOutput };
    };
    getTagsForConfig: {
      query: { input: PromptConfigTagsTrpcInput; output: PromptConfigTagsTrpcOutput };
    };
    update: { mutation: { input: PromptUpdateTrpcInput; output: PromptUpdateTrpcOutput } };
    updateHandle: {
      mutation: { input: PromptUpdateHandleTrpcInput; output: PromptUpdateHandleTrpcOutput };
    };
  };
  savedViews: {
    create: UnpublishedMutation;
    delete: UnpublishedMutation;
    getAll: UnpublishedQuery;
    rename: UnpublishedMutation;
    reorder: UnpublishedMutation;
  };
  secrets: { list: UnpublishedQuery };
  storedObjects: { headById: UnpublishedQuery };
  traces: {
    getFieldNames: UnpublishedQuery;
    getFormattedSpansDigest: UnpublishedQuery;
    getSampleTraces: UnpublishedQuery;
    getSampleTracesDataset: UnpublishedQuery;
    getTopicCounts: UnpublishedQuery;
    getTracesWithSpansByThreadIds: UnpublishedQuery;
  };
};

/**
 * Everything this family calls: the declared namespaces from the contract plus
 * the borrowed procedures.
 */
export type WorkflowApiMap = ContractApiMap<typeof workflowTrpc> &
  ContractApiMap<typeof workflowOptimizationTrpc> &
  BorrowedProcedures;

/**
 * The Workflows family's typed tRPC hooks. Same machinery, same transport and
 * same React Query cache as the application's `api` proxy - see
 * `createModuleApi` for why separate instances still share cache entries.
 */
export const workflowApi = createModuleApi<WorkflowApiMap>();

/** The studio's slice of the root router: every procedure it calls. */
export type WorkflowApiRouter = RouterFromMap<WorkflowApiMap>;

/** What each procedure in the map takes. */
export type RouterInputs = {
  [K in keyof WorkflowApiMap]: InputsOf<WorkflowApiMap[K]>;
};

/** What each procedure in the map answers, as the browser receives it. */
export type RouterOutputs = OutputsFromMap<WorkflowApiMap>;

type InputsOf<TNode> = TNode extends { query: { input: infer TIn } }
  ? TIn
  : TNode extends { mutation: { input: infer TIn } }
    ? TIn
    : TNode extends { subscription: { input: infer TIn } }
      ? TIn
      : { [K in keyof TNode]: InputsOf<TNode[K]> };
