/**
 * Dataset versions: immutable snapshots of a dataset's columns and rows.
 * Spec: modules/dataset/specs/dataset-versioning.feature.
 */
import type { Named } from "@langwatch/module";
import { z } from "zod";

import { datasetColumnsSchema } from "./dataset.ts";

/** How long a dataset must go without edits before an automatic version is saved. */
export const DATASET_VERSION_QUIET_MS = 3 * 60 * 1000;

/** The most rows of each kind one comparison lists; the counts are always whole. */
export const DATASET_VERSION_COMPARE_LIST_MAX = 200;

export const DATASET_CONTENT_EDITED_EVENT_TYPE = "lw.dataset.content_edited" as const;
export const DATASET_VERSION_SAVED_EVENT_TYPE = "lw.dataset.version_saved" as const;
export const DATASET_VERSION_EVENT_VERSION = "2026-10-27" as const;

const datasetVersionTriggerSchemaDefinition = z.enum([
  "autosave",
  "manual",
  "experiment_run",
  "restore",
  "initial",
]);
export interface DatasetVersionTriggerSchema extends Named<
  typeof datasetVersionTriggerSchemaDefinition
> {}
export const datasetVersionTriggerSchema: DatasetVersionTriggerSchema =
  datasetVersionTriggerSchemaDefinition;
export type DatasetVersionTrigger = z.infer<typeof datasetVersionTriggerSchema>;

/** Who saved a version: a person, an API key, or the platform itself. */
const datasetVersionAuthorSchemaDefinition = z.object({
  kind: z.enum(["user", "api_key", "system"]),
  id: z.string().min(1).nullable(),
});
export interface DatasetVersionAuthorSchema extends Named<
  typeof datasetVersionAuthorSchemaDefinition
> {}
export const datasetVersionAuthorSchema: DatasetVersionAuthorSchema =
  datasetVersionAuthorSchemaDefinition;
export type DatasetVersionAuthor = z.infer<typeof datasetVersionAuthorSchema>;

export const SYSTEM_DATASET_VERSION_AUTHOR: DatasetVersionAuthor = { kind: "system", id: null };

const datasetVersionSchemaDefinition = z.object({
  id: z.string().min(1),
  projectId: z.string().min(1),
  datasetId: z.string().min(1),
  version: z.number().int().positive(),
  name: z.string().nullable(),
  trigger: datasetVersionTriggerSchema,
  contentHash: z.string().min(1),
  columnTypes: datasetColumnsSchema,
  rowCount: z.number().int().nonnegative(),
  sizeBytes: z.number().int().nonnegative(),
  chunkCount: z.number().int().nonnegative(),
  restoredFromVersion: z.number().int().positive().nullable(),
  authorId: z.string().nullable(),
  authorKind: z.enum(["user", "api_key", "system"]).nullable(),
  pinned: z.boolean(),
  /** How many experiment runs read this version. */
  runCount: z.number().int().nonnegative(),
  createdAt: z.date(),
});
export interface DatasetVersionSchema extends Named<typeof datasetVersionSchemaDefinition> {}
export const datasetVersionSchema: DatasetVersionSchema = datasetVersionSchemaDefinition;
export type DatasetVersion = z.infer<typeof datasetVersionSchema>;

/** One row of a version, under the id it had when the version was saved. */
const datasetVersionRowSchemaDefinition = z.object({
  id: z.string().min(1),
  entry: z.record(z.string(), z.unknown()),
});
export interface DatasetVersionRowSchema extends Named<typeof datasetVersionRowSchemaDefinition> {}
export const datasetVersionRowSchema: DatasetVersionRowSchema = datasetVersionRowSchemaDefinition;
export type DatasetVersionRow = z.infer<typeof datasetVersionRowSchema>;

const datasetVersionLookupInputSchemaDefinition = z.object({
  projectId: z.string().min(1),
  datasetId: z.string().min(1),
  version: z.number().int().positive(),
});
export interface DatasetVersionLookupInputSchema extends Named<
  typeof datasetVersionLookupInputSchemaDefinition
> {}
export const datasetVersionLookupInputSchema: DatasetVersionLookupInputSchema =
  datasetVersionLookupInputSchemaDefinition;
export type DatasetVersionLookupInput = z.infer<typeof datasetVersionLookupInputSchema>;

const listDatasetVersionsInputSchemaDefinition = z.object({
  projectId: z.string().min(1),
  datasetId: z.string().min(1),
});
export interface ListDatasetVersionsInputSchema extends Named<
  typeof listDatasetVersionsInputSchemaDefinition
> {}
export const listDatasetVersionsInputSchema: ListDatasetVersionsInputSchema =
  listDatasetVersionsInputSchemaDefinition;
export type ListDatasetVersionsInput = z.infer<typeof listDatasetVersionsInputSchema>;

const saveDatasetVersionInputSchemaDefinition = z.object({
  projectId: z.string().min(1),
  datasetId: z.string().min(1),
  name: z.string().trim().min(1).max(120).optional(),
});
export interface SaveDatasetVersionInputSchema extends Named<
  typeof saveDatasetVersionInputSchemaDefinition
> {}
export const saveDatasetVersionInputSchema: SaveDatasetVersionInputSchema =
  saveDatasetVersionInputSchemaDefinition;
export type SaveDatasetVersionInput = z.infer<typeof saveDatasetVersionInputSchema>;

const datasetVersionPageInputSchemaDefinition = z.object({
  ...datasetVersionLookupInputSchema.shape,
  page: z.number().int().positive().default(1),
  limit: z.number().int().positive().max(500).default(50),
});
export interface DatasetVersionPageInputSchema extends Named<
  typeof datasetVersionPageInputSchemaDefinition
> {}
export const datasetVersionPageInputSchema: DatasetVersionPageInputSchema =
  datasetVersionPageInputSchemaDefinition;
export type DatasetVersionPageInput = z.input<typeof datasetVersionPageInputSchema>;

const datasetVersionPageSchemaDefinition = z.object({
  version: datasetVersionSchema,
  rows: z.array(datasetVersionRowSchema),
  pagination: z.object({
    page: z.number().int().positive(),
    limit: z.number().int().positive(),
    total: z.number().int().nonnegative(),
  }),
});
export interface DatasetVersionPageSchema extends Named<
  typeof datasetVersionPageSchemaDefinition
> {}
export const datasetVersionPageSchema: DatasetVersionPageSchema =
  datasetVersionPageSchemaDefinition;
export type DatasetVersionPage = z.infer<typeof datasetVersionPageSchema>;

const compareDatasetVersionInputSchemaDefinition = z.object({
  ...datasetVersionLookupInputSchema.shape,
  /** The version to compare with; absent compares with the current content. */
  against: z.number().int().positive().optional(),
});
export interface CompareDatasetVersionInputSchema extends Named<
  typeof compareDatasetVersionInputSchemaDefinition
> {}
export const compareDatasetVersionInputSchema: CompareDatasetVersionInputSchema =
  compareDatasetVersionInputSchemaDefinition;
export type CompareDatasetVersionInput = z.infer<typeof compareDatasetVersionInputSchema>;

const datasetVersionComparisonSchemaDefinition = z.object({
  version: z.number().int().positive(),
  /** The version compared with, or null for the current content. */
  against: z.number().int().positive().nullable(),
  columns: z.object({ added: z.array(z.string()), removed: z.array(z.string()) }),
  counts: z.object({
    added: z.number().int().nonnegative(),
    removed: z.number().int().nonnegative(),
    changed: z.number().int().nonnegative(),
    unchanged: z.number().int().nonnegative(),
  }),
  added: z.array(datasetVersionRowSchema),
  removed: z.array(datasetVersionRowSchema),
  changed: z.array(
    z.object({
      id: z.string().min(1),
      before: z.record(z.string(), z.unknown()),
      after: z.record(z.string(), z.unknown()),
    }),
  ),
  /** True when a list holds fewer rows than its count says. */
  truncated: z.boolean(),
});
export interface DatasetVersionComparisonSchema extends Named<
  typeof datasetVersionComparisonSchemaDefinition
> {}
export const datasetVersionComparisonSchema: DatasetVersionComparisonSchema =
  datasetVersionComparisonSchemaDefinition;
export type DatasetVersionComparison = z.infer<typeof datasetVersionComparisonSchema>;

/** What a restore answers: the version it wrote, or the latest one when nothing changed. */
const datasetVersionRestoredSchemaDefinition = z.object({
  version: datasetVersionSchema,
  changed: z.boolean(),
});
export interface DatasetVersionRestoredSchema extends Named<
  typeof datasetVersionRestoredSchemaDefinition
> {}
export const datasetVersionRestoredSchema: DatasetVersionRestoredSchema =
  datasetVersionRestoredSchemaDefinition;
export type DatasetVersionRestored = z.infer<typeof datasetVersionRestoredSchema>;

/** The dataset version one experiment run read. */
const datasetVersionRunLinkSchemaDefinition = z.object({
  runId: z.string().min(1),
  datasetId: z.string().min(1),
  versionId: z.string().min(1),
  version: z.number().int().positive(),
});
export interface DatasetVersionRunLinkSchema extends Named<
  typeof datasetVersionRunLinkSchemaDefinition
> {}
export const datasetVersionRunLinkSchema: DatasetVersionRunLinkSchema =
  datasetVersionRunLinkSchemaDefinition;
export type DatasetVersionRunLink = z.infer<typeof datasetVersionRunLinkSchema>;

const findRunDatasetVersionsInputSchemaDefinition = z.object({
  projectId: z.string().min(1),
  runIds: z.array(z.string().min(1)).max(200),
});
export interface FindRunDatasetVersionsInputSchema extends Named<
  typeof findRunDatasetVersionsInputSchemaDefinition
> {}
export const findRunDatasetVersionsInputSchema: FindRunDatasetVersionsInputSchema =
  findRunDatasetVersionsInputSchemaDefinition;
export type FindRunDatasetVersionsInput = z.infer<typeof findRunDatasetVersionsInputSchema>;

/** A version's whole content, for a run that reads every row. */
export type DatasetVersionContent = {
  version: DatasetVersion;
  rows: DatasetVersionRow[];
};

const datasetContentEditedEventDataSchemaDefinition = z.object({
  projectId: z.string().min(1),
  datasetId: z.string().min(1),
  editedBy: datasetVersionAuthorSchema,
});
export interface DatasetContentEditedEventDataSchema extends Named<
  typeof datasetContentEditedEventDataSchemaDefinition
> {}
export const datasetContentEditedEventDataSchema: DatasetContentEditedEventDataSchema =
  datasetContentEditedEventDataSchemaDefinition;
export type DatasetContentEditedEventData = z.infer<typeof datasetContentEditedEventDataSchema>;

const datasetVersionSavedEventDataSchemaDefinition = z.object({
  projectId: z.string().min(1),
  datasetId: z.string().min(1),
  versionId: z.string().min(1),
  version: z.number().int().positive(),
  trigger: datasetVersionTriggerSchema,
});
export interface DatasetVersionSavedEventDataSchema extends Named<
  typeof datasetVersionSavedEventDataSchemaDefinition
> {}
export const datasetVersionSavedEventDataSchema: DatasetVersionSavedEventDataSchema =
  datasetVersionSavedEventDataSchemaDefinition;
export type DatasetVersionSavedEventData = z.infer<typeof datasetVersionSavedEventDataSchema>;
