/**
 * @see ./types.ts — the shapes
 * @see ../provisioning/accessModel.ts — the approved views, the engine tables and the role
 * @see specs/analytics/lwql-api.feature
 */

import type { LangWatchQLViewDefinition } from "../services/langwatch-ql-catalog-shapes.service.ts";

/**
 * How far behind the application's writes these datasets can be. They are read live off the
 * primary through the named collection, so there is no pipeline to lag: a row committed in
 * PostgreSQL is visible to the next LangWatchQL query.
 */
const LIVE_FRESHNESS = "live — read from PostgreSQL at query time";

/**
 * The name every approved view exposes the owning project under. The application's schema calls
 * it `projectId` on most tables and `id` on `Project` itself.
 */
const TENANT_COLUMN = "TenantId";

/** Annotations: one row per human annotation of a trace. */
const ANNOTATIONS: LangWatchQLViewDefinition = {
  name: "annotations",
  sourceTable: "annotations_pg",
  postgres: {
    baseRelation: "Annotation",
    approvedView: "lwql_annotations",
    tenantSourceColumn: "projectId",
  },
  description: "One row per human annotation of a trace, with the reviewer's thumbs verdict.",
  gates: [],
  grain: "one row per AnnotationId",
  joinKeys: ["TenantId", "TraceId"],
  timeColumn: "CreatedAt",
  freshness: LIVE_FRESHNESS,
  dedup: { keyColumns: ["AnnotationId"] },
  columns: [
    {
      name: TENANT_COLUMN,
      type: "String",
      description: "Project the annotation belongs to.",
      gates: [],
      sourceColumns: ["projectId"],
    },
    {
      name: "AnnotationId",
      type: "String",
      description: "Annotation identifier, unique within the project.",
      gates: [],
      sourceColumns: ["id"],
    },
    {
      name: "TraceId",
      type: "String",
      description: "Trace the annotation was left on. Join key to `traces`.",
      gates: [],
      sourceColumns: ["traceId"],
    },
    {
      name: "IsThumbsUp",
      type: "Nullable(Bool)",
      description:
        "The reviewer's verdict: true for thumbs up, false for thumbs down, null when they left only a score.",
      gates: [],
      sourceColumns: ["isThumbsUp"],
    },
    {
      name: "CreatedAt",
      type: "DateTime64(3)",
      description: "When the annotation was left.",
      gates: [],
      sourceColumns: ["createdAt"],
    },
    {
      name: "UpdatedAt",
      type: "DateTime64(3)",
      description: "When the annotation was last changed.",
      gates: [],
      sourceColumns: ["updatedAt"],
    },
  ],
};

/**
 * Projects: the caller's own project, one row. The row policy resolves the tenant to exactly
 * one project, so this dataset is a single row by construction.
 */
const PROJECTS: LangWatchQLViewDefinition = {
  name: "projects",
  sourceTable: "projects_pg",
  postgres: {
    baseRelation: "Project",
    approvedView: "lwql_projects",
    tenantSourceColumn: "id",
  },
  description: "The caller's project, with its display name and slug.",
  gates: [],
  grain: "one row per TenantId",
  joinKeys: ["TenantId"],
  timeColumn: "CreatedAt",
  freshness: LIVE_FRESHNESS,
  dedup: { keyColumns: [TENANT_COLUMN] },
  columns: [
    {
      name: TENANT_COLUMN,
      type: "String",
      description: "Project identifier. Join key to every other dataset.",
      gates: [],
      sourceColumns: ["id"],
    },
    {
      name: "ProjectName",
      type: "String",
      description: "Display name of the project.",
      gates: [],
      sourceColumns: ["name"],
    },
    {
      name: "ProjectSlug",
      type: "String",
      description: "URL-safe name of the project.",
      gates: [],
      sourceColumns: ["slug"],
    },
    {
      name: "CreatedAt",
      type: "DateTime64(3)",
      description: "When the project was created.",
      gates: [],
      sourceColumns: ["createdAt"],
    },
  ],
};

/** Prompts: one row per prompt configuration. */
const PROMPTS: LangWatchQLViewDefinition = {
  name: "prompts",
  sourceTable: "prompts_pg",
  postgres: {
    baseRelation: "LlmPromptConfig",
    approvedView: "lwql_prompts",
    tenantSourceColumn: "projectId",
  },
  description: "One row per prompt configuration, with the name its versions are known by.",
  gates: [],
  grain: "one row per PromptId",
  joinKeys: ["TenantId", "PromptId"],
  timeColumn: "CreatedAt",
  freshness: LIVE_FRESHNESS,
  dedup: { keyColumns: ["PromptId"] },
  columns: [
    {
      name: TENANT_COLUMN,
      type: "String",
      description: "Project the prompt belongs to.",
      gates: [],
      sourceColumns: ["projectId"],
    },
    {
      name: "PromptId",
      type: "String",
      description:
        "Prompt identifier. Matches `traces.LastUsedPromptId` and `traces.SelectedPromptId`.",
      gates: [],
      sourceColumns: ["id"],
    },
    {
      name: "PromptName",
      type: "String",
      description: "Display name of the prompt.",
      gates: [],
      sourceColumns: ["name"],
    },
    {
      name: "PromptHandle",
      type: "Nullable(String)",
      description: "Globally unique handle of the prompt, null when it has none.",
      gates: [],
      sourceColumns: ["handle"],
    },
    {
      name: "CreatedAt",
      type: "DateTime64(3)",
      description: "When the prompt was created.",
      gates: [],
      sourceColumns: ["createdAt"],
    },
    // `DeletedAt` and not `ArchivedAt`, which is the spelling the rest of this file uses:
    // `LlmPromptConfig` really does soft-delete through `deletedAt` and declares no
    // `archivedAt` at all, so the house spelling here would publish a column name for a field
    // that does not exist. An exposed name tracks the field behind it; where the two agree —
    // `Experiment.archivedAt` — the exposed name is `ArchivedAt`.
    {
      name: "DeletedAt",
      type: "Nullable(DateTime64(3))",
      description: "When the prompt was deleted, null while it is live.",
      gates: [],
      sourceColumns: ["deletedAt"],
    },
  ],
};

/** Prompt versions: one row per published version of a prompt. */
const PROMPT_VERSIONS: LangWatchQLViewDefinition = {
  name: "prompt_versions",
  sourceTable: "prompt_versions_pg",
  postgres: {
    baseRelation: "LlmPromptConfigVersion",
    approvedView: "lwql_prompt_versions",
    tenantSourceColumn: "projectId",
  },
  description: "One row per version of a prompt, carrying the version number a trace records.",
  gates: [],
  grain: "one row per PromptVersionId",
  joinKeys: ["TenantId", "PromptVersionId", "PromptId"],
  timeColumn: "CreatedAt",
  freshness: LIVE_FRESHNESS,
  dedup: { keyColumns: ["PromptVersionId"] },
  columns: [
    {
      name: TENANT_COLUMN,
      type: "String",
      description: "Project the prompt version belongs to.",
      gates: [],
      sourceColumns: ["projectId"],
    },
    {
      name: "PromptVersionId",
      type: "String",
      description: "Version identifier. Matches `traces.LastUsedPromptVersionId`.",
      gates: [],
      sourceColumns: ["id"],
    },
    {
      name: "PromptId",
      type: "String",
      description: "Prompt this is a version of. Join key to `prompts`.",
      gates: [],
      sourceColumns: ["configId"],
    },
    {
      name: "VersionNumber",
      type: "Int32",
      description:
        "Version number within the prompt. Matches `traces.LastUsedPromptVersionNumber`.",
      gates: [],
      sourceColumns: ["version"],
    },
    {
      name: "CreatedAt",
      type: "DateTime64(3)",
      description: "When the version was published.",
      gates: [],
      sourceColumns: ["createdAt"],
    },
  ],
};

/** Experiments: one row per experiment. */
const EXPERIMENTS: LangWatchQLViewDefinition = {
  name: "experiments",
  sourceTable: "experiments_pg",
  postgres: {
    baseRelation: "Experiment",
    approvedView: "lwql_experiments",
    tenantSourceColumn: "projectId",
  },
  description: "One row per experiment, with its display name and kind.",
  gates: [],
  grain: "one row per ExperimentId",
  joinKeys: ["TenantId", "ExperimentId"],
  timeColumn: "CreatedAt",
  freshness: LIVE_FRESHNESS,
  dedup: { keyColumns: ["ExperimentId"] },
  columns: [
    {
      name: TENANT_COLUMN,
      type: "String",
      description: "Project the experiment belongs to.",
      gates: [],
      sourceColumns: ["projectId"],
    },
    {
      name: "ExperimentId",
      type: "String",
      description: "Experiment identifier, as carried by the fact tables that reference it.",
      gates: [],
      sourceColumns: ["id"],
    },
    {
      name: "ExperimentName",
      type: "Nullable(String)",
      description: "Display name of the experiment, null when it was never named.",
      gates: [],
      sourceColumns: ["name"],
    },
    {
      name: "ExperimentSlug",
      type: "String",
      description: "URL-safe name of the experiment, unique within the project.",
      gates: [],
      sourceColumns: ["slug"],
    },
    {
      name: "ExperimentType",
      type: "String",
      description: "Kind of experiment, as the application classifies it.",
      gates: [],
      sourceColumns: ["type"],
    },
    {
      name: "CreatedAt",
      type: "DateTime64(3)",
      description: "When the experiment was created.",
      gates: [],
      sourceColumns: ["createdAt"],
    },
    {
      name: "ArchivedAt",
      type: "Nullable(DateTime64(3))",
      description: "When the experiment was archived, null while it is live.",
      gates: [],
      sourceColumns: ["archivedAt"],
    },
  ],
};

/** Batch evaluations: one row per offline evaluation of a dataset row. */
const BATCH_EVALUATIONS: LangWatchQLViewDefinition = {
  name: "batch_evaluations",
  sourceTable: "batch_evaluations_pg",
  postgres: {
    baseRelation: "BatchEvaluation",
    approvedView: "lwql_batch_evaluations",
    tenantSourceColumn: "projectId",
  },
  description:
    "One row per offline batch evaluation of a dataset row, with its score, outcome and cost.",
  gates: [],
  grain: "one row per BatchEvaluationId",
  joinKeys: ["TenantId", "BatchEvaluationId", "ExperimentId", "DatasetId"],
  timeColumn: "CreatedAt",
  freshness: LIVE_FRESHNESS,
  dedup: { keyColumns: ["BatchEvaluationId"] },
  columns: [
    {
      name: TENANT_COLUMN,
      type: "String",
      description: "Project the batch evaluation belongs to.",
      gates: [],
      sourceColumns: ["projectId"],
    },
    {
      name: "BatchEvaluationId",
      type: "String",
      description: "Batch evaluation identifier, unique within the project.",
      gates: [],
      sourceColumns: ["id"],
    },
    {
      name: "ExperimentId",
      type: "String",
      description:
        "Experiment this batch evaluation belongs to. Join key to `experiments`.",
      gates: [],
      sourceColumns: ["experimentId"],
    },
    {
      name: "DatasetId",
      type: "String",
      description: "Dataset the evaluated row came from.",
      gates: [],
      sourceColumns: ["datasetId"],
    },
    {
      name: "DatasetSlug",
      type: "String",
      description: "URL-safe name of the dataset the evaluated row came from.",
      gates: [],
      sourceColumns: ["datasetSlug"],
    },
    {
      name: "Evaluation",
      type: "String",
      description: "Name of the evaluator that produced this result.",
      gates: [],
      sourceColumns: ["evaluation"],
    },
    {
      name: "Status",
      type: "String",
      description: "Terminal state of the evaluation.",
      gates: [],
      sourceColumns: ["status"],
    },
    {
      name: "Score",
      type: "Float64",
      description: "Numeric score the evaluator produced.",
      gates: [],
      sourceColumns: ["score"],
    },
    {
      name: "Label",
      type: "Nullable(String)",
      description: "Categorical outcome, when the evaluator produced one.",
      gates: [],
      sourceColumns: ["label"],
    },
    {
      name: "Passed",
      type: "Bool",
      description: "Pass/fail outcome the evaluator produced.",
      gates: [],
      sourceColumns: ["passed"],
    },
    {
      name: "Cost",
      type: "Float64",
      unit: "USD",
      description: "Billed cost of running the evaluation, in USD.",
      gates: ["costs"],
      sourceColumns: ["cost"],
    },
    {
      name: "CreatedAt",
      type: "DateTime64(3)",
      description: "When the batch evaluation was created.",
      gates: [],
      sourceColumns: ["createdAt"],
    },
    {
      name: "UpdatedAt",
      type: "DateTime64(3)",
      description: "When the batch evaluation was last changed.",
      gates: [],
      sourceColumns: ["updatedAt"],
    },
  ],
};

/**
 * The PostgreSQL-resident datasets, in the order the schema endpoint lists
 * them: the entity a question is about, then the dimensions that name it.
 */
export const LWQL_POSTGRES_CATALOG: readonly LangWatchQLViewDefinition[] = [
  ANNOTATIONS,
  EXPERIMENTS,
  BATCH_EVALUATIONS,
  PROJECTS,
  PROMPTS,
  PROMPT_VERSIONS,
];
