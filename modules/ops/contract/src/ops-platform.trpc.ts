import { operatorFeatureFlagCatalogueSchema } from "@langwatch/feature-flag-contract";
/**
 * The deployment-wide levers an operator pulls: feature flags and the blob
 * store. Anything that can destroy a payload also
 * asks for a non-impersonated session and a typed `confirm`.
 */
import { defineTrpcContract } from "@langwatch/module";
import { z } from "zod";

import {
  blobSweepReportSchema,
  deleteBlobOperatorInputSchema,
  deleteBlobResultSchema,
  getBlobInputSchema,
  listBlobsInputSchema,
  opsBlobPageSchema,
  opsBlobStoreStatsSchema,
  opsBlobSummarySchema,
  runBlobCleanupOperatorInputSchema,
} from "./blob-store.ts";
import {
  opsFeatureFlagKeyInputSchema,
  opsOkOutputSchema,
  opsSetFeatureFlagInputSchema,
  opsSetFeatureFlagRulesInputSchema,
} from "./ops-feature-flag.ts";
import { opsQueueNameListSchema } from "./ops.responses.ts";

export const opsPlatformTrpc = defineTrpcContract("ops")
  /**
   * Every registered feature flag plus any orphaned stored rows, so an
   * operator can see the source of truth for each flag before flipping
   * anything. Read-only, and it costs no flag call.
   */
  .query("listFeatureFlags")
  .withInput(z.void())
  .withOutput(operatorFeatureFlagCatalogueSchema)

  .mutation("setFeatureFlag")
  .withInput(opsSetFeatureFlagInputSchema)
  .withOutput(opsOkOutputSchema)

  .mutation("setFeatureFlagRules")
  .withInput(opsSetFeatureFlagRulesInputSchema)
  .withOutput(opsOkOutputSchema)

  .mutation("clearFeatureFlag")
  .withInput(opsFeatureFlagKeyInputSchema)
  .withOutput(opsOkOutputSchema)

  .query("listBlobQueues")
  .withInput(z.void())
  .withOutput(opsQueueNameListSchema)

  .query("getBlobStoreStats")
  .withInput(z.void())
  .withOutput(opsBlobStoreStatsSchema)

  .query("listBlobs")
  .withInput(listBlobsInputSchema)
  .withOutput(opsBlobPageSchema)

  .query("getBlob")
  .withInput(getBlobInputSchema)
  .withOutput(opsBlobSummarySchema.nullable())

  .mutation("runBlobCleanup")
  .withInput(runBlobCleanupOperatorInputSchema)
  .withOutput(blobSweepReportSchema)

  .mutation("deleteBlob")
  .withInput(deleteBlobOperatorInputSchema)
  .withOutput(deleteBlobResultSchema)
  .build();
