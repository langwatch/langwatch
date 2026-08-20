/**
 * LangWatchQL analytics SQL — the PostgreSQL-resident half of the catalog.
 *
 * Same shape as the ClickHouse-resident entries and read by the same consumers;
 * what differs is where the rows live and how they arrive. Each entry declares
 * a {@link LangWatchQLPostgresMapping}, and that declaration generates the whole
 * chain: the approved PostgreSQL view, the reader role's grant on it, the
 * PostgreSQL-engine table in the LangWatchQL database, its row policy, and the
 * LangWatchQL view a caller names.
 *
 * ## Why these six datasets and no others
 *
 * They are what the three question classes the catalog could not answer need,
 * and nothing else. Cost by *name* needs `projects`, `prompts` and
 * `prompt_versions`, because the fact tables carry only the identifiers.
 * Annotation-versus-evaluation agreement needs `annotations`. Experiment run
 * comparisons need `experiments` and `experiment_runs`. Models are already
 * names on the fact tables (`traces.Models` carries `openai/gpt-5-mini`, not an
 * id), so no dimension is mapped for them — mapping one would put load on the
 * primary to resolve a name ClickHouse already has.
 *
 * ## What is deliberately absent, and why per column rather than per table
 *
 * The approved view is the boundary: a column left out of it is unreachable,
 * because the reader role has no grant on the base table. Three kinds are left
 * out, on the same reasoning the ClickHouse half applies:
 *
 *  - **Free-text carriers with no gate in the canonical visibility policy** —
 *    `Annotation.comment` and `expectedOutput`, `LlmPromptConfigVersion.commitMessage`,
 *    `BatchEvaluation.details`. Each routinely quotes the payload it describes,
 *    and no rule in the visibility policy gates them, so exposing them would
 *    mean inventing a gate rather than deriving one.
 *  - **JSON blobs carrying captured content** — `Annotation.scoreOptions`,
 *    `LlmPromptConfigVersion.configData` (the prompt text itself),
 *    `BatchEvaluation.data` (the evaluated rows), `Experiment.workbenchState`.
 *  - **Person-identifying columns** — `Annotation.userId` and `email`,
 *    `LlmPromptConfigVersion.authorId`. Analytics answers questions about
 *    traffic, not about named colleagues, and the API has no permission that
 *    would gate them.
 *
 * `Project.apiKey` is absent for a fourth reason that is worth stating on its
 * own: it is a credential, and the whole model rests on the caller never
 * reaching one.
 *
 * @see ./types.ts — the shapes
 * @see ../provisioning.ts — the approved views, the engine tables and the role
 * @see specs/analytics/lwql-api.feature
 */

import type { LangWatchQLViewDefinition } from "./types";

/**
 * How far behind the application's writes these datasets can be.
 *
 * They are read live off the primary through the named collection, so there is
 * no pipeline to lag: a row committed in PostgreSQL is visible to the next
 * LangWatchQL query. Published so a caller comparing a dimension against a fact
 * knows which side can be stale, and it is the fact side.
 */
const LIVE_FRESHNESS = "live — read from PostgreSQL at query time";

/**
 * The name every approved view exposes the owning project under.
 *
 * The application's schema calls it `projectId` on most tables and `id` on
 * `Project` itself. Reconciling both to `TenantId` in the approved view is what
 * lets a caller join a PostgreSQL-resident dataset to a ClickHouse-resident one
 * without knowing which is which, and it is what lets one row policy shape
 * serve every LangWatchQL object.
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
  description:
    "One row per human annotation of a trace, with the reviewer's thumbs verdict.",
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
 * Projects: the caller's own project, one row.
 *
 * The row policy resolves the tenant to exactly one project, so this dataset is
 * a single row by construction. It is here because a caller reporting cost "by
 * project" wants the name in the output, and because a multi-project report
 * assembled by a client needs somewhere to read that name from.
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
  description:
    "One row per prompt configuration, with the name its versions are known by.",
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
      description:
        "Globally unique handle of the prompt, null when it has none.",
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
    // `DeletedAt` and not `ArchivedAt`, which is the spelling the rest of this
    // file uses: `LlmPromptConfig` really does soft-delete through `deletedAt`
    // and declares no `archivedAt` at all, so the house spelling here would
    // publish a column name for a field that does not exist. An exposed name
    // tracks the field behind it; where the two agree — `Experiment.archivedAt`
    // — the exposed name is `ArchivedAt`.
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
  description:
    "One row per version of a prompt, carrying the version number a trace records.",
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
      description:
        "Version identifier. Matches `traces.LastUsedPromptVersionId`.",
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
      description: "Experiment identifier. Join key to `experiment_runs`.",
      gates: [],
      sourceColumns: ["id"],
    },
    {
      name: "ExperimentName",
      type: "Nullable(String)",
      description:
        "Display name of the experiment, null when it was never named.",
      gates: [],
      sourceColumns: ["name"],
    },
    {
      name: "ExperimentSlug",
      type: "String",
      description:
        "URL-safe name of the experiment, unique within the project.",
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

/** Experiment runs: one row per batch evaluation of an experiment. */
const EXPERIMENT_RUNS: LangWatchQLViewDefinition = {
  name: "experiment_runs",
  sourceTable: "experiment_runs_pg",
  postgres: {
    baseRelation: "BatchEvaluation",
    approvedView: "lwql_experiment_runs",
    tenantSourceColumn: "projectId",
  },
  description:
    "One row per run of an experiment, with the score, verdict and cost it recorded.",
  gates: [],
  grain: "one row per ExperimentRunId",
  joinKeys: ["TenantId", "ExperimentRunId", "ExperimentId"],
  timeColumn: "CreatedAt",
  freshness: LIVE_FRESHNESS,
  dedup: { keyColumns: ["ExperimentRunId"] },
  columns: [
    {
      name: TENANT_COLUMN,
      type: "String",
      description: "Project the run belongs to.",
      gates: [],
      sourceColumns: ["projectId"],
    },
    {
      name: "ExperimentRunId",
      type: "String",
      description: "Run identifier, unique within the project.",
      gates: [],
      sourceColumns: ["id"],
    },
    {
      name: "ExperimentId",
      type: "String",
      description: "Experiment this run belongs to. Join key to `experiments`.",
      gates: [],
      sourceColumns: ["experimentId"],
    },
    {
      name: "EvaluationName",
      type: "String",
      description: "Evaluator the run was scored by.",
      gates: [],
      sourceColumns: ["evaluation"],
    },
    {
      name: "Status",
      type: "String",
      description: "How the run ended, as the application records it.",
      gates: [],
      sourceColumns: ["status"],
    },
    {
      name: "Score",
      type: "Float64",
      description: "Score the evaluator returned for the run.",
      gates: [],
      sourceColumns: ["score"],
    },
    {
      name: "Label",
      type: "Nullable(String)",
      description:
        "Categorical verdict the evaluator returned, null when it returned none.",
      gates: [],
      sourceColumns: ["label"],
    },
    {
      name: "Passed",
      type: "Bool",
      description: "Whether the run met the evaluator's bar.",
      gates: [],
      sourceColumns: ["passed"],
    },
    {
      name: "Cost",
      type: "Float64",
      unit: "USD",
      description: "What the run cost to execute.",
      gates: ["costs"],
      sourceColumns: ["cost"],
    },
    {
      name: "DatasetId",
      type: "String",
      description: "Dataset the run evaluated.",
      gates: [],
      sourceColumns: ["datasetId"],
    },
    {
      name: "DatasetSlug",
      type: "String",
      description: "URL-safe name of the dataset the run evaluated.",
      gates: [],
      sourceColumns: ["datasetSlug"],
    },
    {
      name: "CreatedAt",
      type: "DateTime64(3)",
      description: "When the run was recorded.",
      gates: [],
      sourceColumns: ["createdAt"],
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
  EXPERIMENT_RUNS,
  PROJECTS,
  PROMPTS,
  PROMPT_VERSIONS,
];
