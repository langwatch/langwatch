import type { Named } from "@langwatch/module";
import { z } from "zod";

/** One content-addressed blob as the ops surface sees it. */
const opsBlobSummarySchemaDefinition = z.object({
  queueName: z.string(),
  projectId: z.string(),
  hash: z.string(),
  sizeBytes: z.number(),
  ttlSeconds: z.number().nullable(),
  liveLeases: z.number(),
  holderTokens: z.number(),
  earliestLeaseDeadlineMs: z.number().nullable(),
  sweepOutcome: z.string(),
});
export interface OpsBlobSummarySchema extends Named<typeof opsBlobSummarySchemaDefinition> {}
export const opsBlobSummarySchema: OpsBlobSummarySchema = opsBlobSummarySchemaDefinition;

export type OpsBlobSummary = z.infer<typeof opsBlobSummarySchema>;

/** The supported blob listing orderings. */
export const OPS_BLOB_SORTS = [
  "scan",
  "largest",
  "stalest",
  "unreferenced",
  "oldest_lapsed_lease",
] as const;

export type OpsBlobSort = (typeof OPS_BLOB_SORTS)[number];

const listBlobsInputSchemaDefinition = z.object({
  queueName: z.string().min(1).max(200),
  cursor: z.string().max(4000).nullish(),
  limit: z.number().int().min(1).max(200).default(50),
  projectId: z.string().max(200).nullish(),
  sort: z.enum(OPS_BLOB_SORTS).default("largest"),
});
export interface ListBlobsInputSchema extends Named<typeof listBlobsInputSchemaDefinition> {}
export const listBlobsInputSchema: ListBlobsInputSchema = listBlobsInputSchemaDefinition;

export type ListBlobsInput = z.infer<typeof listBlobsInputSchema>;

const getBlobInputSchemaDefinition = z.object({
  queueName: z.string().min(1).max(200),
  projectId: z.string().min(1).max(200),
  hash: z.string().min(1).max(200),
});
export interface GetBlobInputSchema extends Named<typeof getBlobInputSchemaDefinition> {}
export const getBlobInputSchema: GetBlobInputSchema = getBlobInputSchemaDefinition;

export type GetBlobInput = z.infer<typeof getBlobInputSchema>;

const opsBlobPageSchemaDefinition = z.object({
  blobs: z.array(opsBlobSummarySchema),
  nextCursor: z.string().nullable(),
  sampled: z.number(),
  rankedFromSample: z.boolean(),
});
export interface OpsBlobPageSchema extends Named<typeof opsBlobPageSchemaDefinition> {}
export const opsBlobPageSchema: OpsBlobPageSchema = opsBlobPageSchemaDefinition;
export type OpsBlobPage = z.infer<typeof opsBlobPageSchema>;

const opsBlobStoreStatsSchemaDefinition = z.object({
  queues: z.array(
    z.object({
      queueName: z.string(),
      sampledBlobs: z.number(),
      sampledBytes: z.number(),
      unreferenced: z.number(),
      truncated: z.boolean(),
    }),
  ),
});
export interface OpsBlobStoreStatsSchema extends Named<typeof opsBlobStoreStatsSchemaDefinition> {}
export const opsBlobStoreStatsSchema: OpsBlobStoreStatsSchema = opsBlobStoreStatsSchemaDefinition;
export type OpsBlobStoreStats = z.infer<typeof opsBlobStoreStatsSchema>;

export type BlobSweepOutcome = "leased" | "repaired" | "reclaimed" | "bookkeeping" | "pending";

const blobSweepTallySchema = z.object({
  scanned: z.number(),
  truncated: z.boolean(),
  leased: z.number(),
  repaired: z.number(),
  reclaimed: z.number(),
  bookkeeping: z.number(),
  pending: z.number(),
});

const blobSweepReportSchemaDefinition = z.object({
  queues: z.array(z.object({ queueName: z.string(), ...blobSweepTallySchema.shape })),
  totals: blobSweepTallySchema,
  dryRun: z.boolean(),
  durationMs: z.number(),
});
export interface BlobSweepReportSchema extends Named<typeof blobSweepReportSchemaDefinition> {}
export const blobSweepReportSchema: BlobSweepReportSchema = blobSweepReportSchemaDefinition;

export type BlobSweepTally = z.infer<typeof blobSweepTallySchema>;
export type BlobSweepReport = z.infer<typeof blobSweepReportSchema>;

const runBlobCleanupInputSchemaDefinition = z.object({
  dryRun: z.boolean().default(true),
});
export interface RunBlobCleanupInputSchema extends Named<
  typeof runBlobCleanupInputSchemaDefinition
> {}
export const runBlobCleanupInputSchema: RunBlobCleanupInputSchema =
  runBlobCleanupInputSchemaDefinition;

const runBlobCleanupCommandSchemaDefinition = z.object({
  ...runBlobCleanupInputSchema.shape,
  requestedBy: z.string().min(1),
});
export interface RunBlobCleanupCommandSchema extends Named<
  typeof runBlobCleanupCommandSchemaDefinition
> {}
export const runBlobCleanupCommandSchema: RunBlobCleanupCommandSchema =
  runBlobCleanupCommandSchemaDefinition;

export type RunBlobCleanupInput = z.infer<typeof runBlobCleanupCommandSchema>;

const deleteBlobInputSchemaDefinition = z.object({
  queueName: z.string().min(1).max(200),
  projectId: z.string().min(1).max(200),
  hash: z.string().min(1).max(200),
});
export interface DeleteBlobInputSchema extends Named<typeof deleteBlobInputSchemaDefinition> {}
export const deleteBlobInputSchema: DeleteBlobInputSchema = deleteBlobInputSchemaDefinition;

const deleteBlobCommandSchemaDefinition = z.object({
  ...deleteBlobInputSchema.shape,
  requestedBy: z.string().min(1),
});
export interface DeleteBlobCommandSchema extends Named<typeof deleteBlobCommandSchemaDefinition> {}
export const deleteBlobCommandSchema: DeleteBlobCommandSchema = deleteBlobCommandSchemaDefinition;

export type DeleteBlobInput = z.infer<typeof deleteBlobCommandSchema>;

const deleteBlobResultSchemaDefinition = z.object({ deleted: z.boolean() });
export interface DeleteBlobResultSchema extends Named<typeof deleteBlobResultSchemaDefinition> {}
export const deleteBlobResultSchema: DeleteBlobResultSchema = deleteBlobResultSchemaDefinition;
export type DeleteBlobResult = z.infer<typeof deleteBlobResultSchema>;

/**
 * The operator-transport form of the cleanup request: the sweep itself plus
 * the typed confirmation the destructive (non-dry-run) form requires. A sweep
 * that reclaims is not something to reach by mis-clicking a toggle.
 */
const runBlobCleanupOperatorInputSchemaDefinition = z.object({
  ...runBlobCleanupInputSchema.shape,
  confirm: z.literal("RECLAIM").optional(),
});
export interface RunBlobCleanupOperatorInputSchema extends Named<
  typeof runBlobCleanupOperatorInputSchemaDefinition
> {}
export const runBlobCleanupOperatorInputSchema: RunBlobCleanupOperatorInputSchema =
  runBlobCleanupOperatorInputSchemaDefinition;

/** The operator-transport form of the delete: the blob plus its confirmation. */
const deleteBlobOperatorInputSchemaDefinition = z.object({
  ...deleteBlobInputSchema.shape,
  confirm: z.literal("DELETE"),
});
export interface DeleteBlobOperatorInputSchema extends Named<
  typeof deleteBlobOperatorInputSchemaDefinition
> {}
export const deleteBlobOperatorInputSchema: DeleteBlobOperatorInputSchema =
  deleteBlobOperatorInputSchemaDefinition;
