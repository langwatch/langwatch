import { z } from "zod";

/** One content-addressed blob as the ops surface sees it. */
export const opsBlobSummarySchema = z.object({
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

export const listBlobsInputSchema = z.object({
  queueName: z.string().min(1).max(200),
  cursor: z.string().max(4000).nullish(),
  limit: z.number().int().min(1).max(200).default(50),
  projectId: z.string().max(200).nullish(),
  sort: z.enum(OPS_BLOB_SORTS).default("largest"),
});

export type ListBlobsInput = z.infer<typeof listBlobsInputSchema>;

export const getBlobInputSchema = z.object({
  queueName: z.string().min(1).max(200),
  projectId: z.string().min(1).max(200),
  hash: z.string().min(1).max(200),
});

export type GetBlobInput = z.infer<typeof getBlobInputSchema>;

export const opsBlobPageSchema = z.object({
  blobs: z.array(opsBlobSummarySchema),
  nextCursor: z.string().nullable(),
  sampled: z.number(),
  rankedFromSample: z.boolean(),
});
export type OpsBlobPage = z.infer<typeof opsBlobPageSchema>;

export const opsBlobStoreStatsSchema = z.object({
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
export type OpsBlobStoreStats = z.infer<typeof opsBlobStoreStatsSchema>;

export type BlobSweepOutcome =
  | "leased"
  | "repaired"
  | "reclaimed"
  | "bookkeeping"
  | "pending";

const blobSweepTallySchema = z.object({
  scanned: z.number(),
  truncated: z.boolean(),
  leased: z.number(),
  repaired: z.number(),
  reclaimed: z.number(),
  bookkeeping: z.number(),
  pending: z.number(),
});

export const blobSweepReportSchema = z.object({
  queues: z.array(z.object({ queueName: z.string() }).and(blobSweepTallySchema)),
  totals: blobSweepTallySchema,
  dryRun: z.boolean(),
  durationMs: z.number(),
});

export type BlobSweepTally = z.infer<typeof blobSweepTallySchema>;
export type BlobSweepReport = z.infer<typeof blobSweepReportSchema>;

export const runBlobCleanupInputSchema = z.object({
  dryRun: z.boolean().default(true),
});

export const runBlobCleanupCommandSchema = runBlobCleanupInputSchema.extend({
  requestedBy: z.string().min(1),
});

export type RunBlobCleanupInput = z.infer<typeof runBlobCleanupCommandSchema>;

export const deleteBlobInputSchema = z.object({
  queueName: z.string().min(1).max(200),
  projectId: z.string().min(1).max(200),
  hash: z.string().min(1).max(200),
});

export const deleteBlobCommandSchema = deleteBlobInputSchema.extend({
  requestedBy: z.string().min(1),
});

export type DeleteBlobInput = z.infer<typeof deleteBlobCommandSchema>;

export const deleteBlobResultSchema = z.object({ deleted: z.boolean() });
export type DeleteBlobResult = z.infer<typeof deleteBlobResultSchema>;
