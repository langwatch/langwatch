/**
 * The six views that used to be hand-written in `postgresViews.ts`, now as
 * overrides on the per-model builder.
 *
 * They exist so the exposed names, descriptions and column aliases callers,
 * docs and the Go manifest already depend on stay byte-for-byte what they were
 * before the catalog became opt-out — `LlmPromptConfig.id` is still `PromptId`,
 * the view is still `prompts` and not `llm_prompt_configs`, and so on. What
 * changed is only what the opt-out contract changed everywhere: the free-text
 * columns these views used to drop (a comment, a config blob, an expected
 * output) are now *gated* rather than absent, so a caller with content access
 * can read them and one without cannot.
 *
 * @see ../defineCatalogModel.ts — the per-model builder these refine
 * @see ../postgresViews.ts — where they are assembled into the catalog
 */

import type { PostgresDatasetOverride } from "../defineCatalogModel";

/** The six formerly-hand-written views, keyed by their Prisma model name. */
export const CORE_POSTGRES_OVERRIDES: Record<string, PostgresDatasetOverride> =
  {
    Annotation: {
      description:
        "One row per human annotation of a trace, with the reviewer's thumbs verdict.",
      descriptions: {
        AnnotationId: "Annotation identifier, unique within the project.",
        TraceId: "Trace the annotation was left on. Join key to `traces`.",
        IsThumbsUp:
          "The reviewer's verdict: true for thumbs up, false for thumbs down, null when they left only a score.",
        CreatedAt: "When the annotation was left.",
        UpdatedAt: "When the annotation was last changed.",
      },
    },

    Project: {
      name: "projects",
      description: "The caller's project, with its display name and slug.",
      aliases: { ProjectName: "name", ProjectSlug: "slug" },
      descriptions: {
        ProjectName: "Display name of the project.",
        ProjectSlug: "URL-safe name of the project.",
        CreatedAt: "When the project was created.",
      },
    },

    LlmPromptConfig: {
      name: "prompts",
      description:
        "One row per prompt configuration, with the name its versions are known by.",
      aliases: { PromptId: "id", PromptName: "name", PromptHandle: "handle" },
      descriptions: {
        PromptId:
          "Prompt identifier. Matches `traces.LastUsedPromptId` and `traces.SelectedPromptId`.",
        PromptName: "Display name of the prompt.",
        PromptHandle:
          "Globally unique handle of the prompt, null when it has none.",
        CreatedAt: "When the prompt was created.",
        DeletedAt: "When the prompt was deleted, null while it is live.",
      },
    },

    LlmPromptConfigVersion: {
      name: "prompt_versions",
      description:
        "One row per version of a prompt, carrying the version number a trace records.",
      aliases: {
        PromptVersionId: "id",
        PromptId: "configId",
        VersionNumber: "version",
      },
      descriptions: {
        PromptVersionId:
          "Version identifier. Matches `traces.LastUsedPromptVersionId`.",
        PromptId: "Prompt this is a version of. Join key to `prompts`.",
        VersionNumber:
          "Version number within the prompt. Matches `traces.LastUsedPromptVersionNumber`.",
        CreatedAt: "When the version was published.",
      },
    },

    Experiment: {
      description: "One row per experiment, with its display name and kind.",
      aliases: {
        ExperimentName: "name",
        ExperimentSlug: "slug",
        ExperimentType: "type",
      },
      descriptions: {
        ExperimentId:
          "Experiment identifier, as carried by the fact tables that reference it.",
        ExperimentName:
          "Display name of the experiment, null when it was never named.",
        ExperimentSlug:
          "URL-safe name of the experiment, unique within the project.",
        ExperimentType: "Kind of experiment, as the application classifies it.",
        CreatedAt: "When the experiment was created.",
        ArchivedAt: "When the experiment was archived, null while it is live.",
      },
    },

    BatchEvaluation: {
      description:
        "One row per offline batch evaluation of a dataset row, with its score, outcome and cost.",
      columnUnits: { Cost: "USD" },
      // The validator gates by bare column name across the catalog, and the
      // ClickHouse `evaluations` view already gates `Details` on both content
      // permissions (it quotes the evaluated input and output), so the
      // Postgres column must carry the same gates or one view withholds what
      // the other publishes.
      columnGates: { Details: ["input", "output"] },
      descriptions: {
        BatchEvaluationId:
          "Batch evaluation identifier, unique within the project.",
        ExperimentId:
          "Experiment this batch evaluation belongs to. Join key to `experiments`.",
        DatasetId: "Dataset the evaluated row came from.",
        DatasetSlug:
          "URL-safe name of the dataset the evaluated row came from.",
        Evaluation: "Name of the evaluator that produced this result.",
        Status: "Terminal state of the evaluation.",
        Score: "Numeric score the evaluator produced.",
        Label: "Categorical outcome, when the evaluator produced one.",
        Passed: "Pass/fail outcome the evaluator produced.",
        Cost: "Billed cost of running the evaluation, in USD.",
        CreatedAt: "When the batch evaluation was created.",
        UpdatedAt: "When the batch evaluation was last changed.",
      },
    },
  };
