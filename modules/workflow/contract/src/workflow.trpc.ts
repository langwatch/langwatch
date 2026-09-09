/**
 * Every `workflow.*` procedure, declared once. The names are the browser's
 * cache keys, so they are the wire names the Optimization Studio has always
 * called.
 */
import { defineTrpcContract } from "@langwatch/api/contract";
import { z } from "zod";

import {
  workflowSchema,
  workflowVersionHistoryEntrySchema,
  workflowVersionSchema,
  workflowWithVersionSchema,
} from "./workflow.ts";
import {
  workflowApiArchiveInputSchema,
  workflowApiAutosaveInputSchema,
  workflowApiCommitVersionInputSchema,
  workflowApiCopyInputSchema,
  workflowApiCreateInputSchema,
  workflowApiEngineModeInputSchema,
  workflowApiGenerateCommitMessageInputSchema,
  workflowApiGetByIdInputSchema,
  workflowApiGetVersionsInputSchema,
  workflowApiProjectInputSchema,
  workflowApiPublishInputSchema,
  workflowApiPushToCopiesInputSchema,
  workflowApiRestoreVersionInputSchema,
  workflowApiWorkflowInputSchema,
  workflowCascadeArchiveSchema,
  workflowCopyRowSchema,
  workflowEngineModeSchema,
  workflowListRowSchema,
  workflowPushToCopiesSchema,
  workflowRelatedEntitiesSchema,
  workflowWithNewVersionSchema,
} from "./workflow.trpc-schemas.ts";

/**
 * What a sync answers: the copy row the process read beside the version it
 * wrote. Left open because the row is the process's own copy-lineage read, and
 * naming a shape here would narrow what the studio is handed.
 */
const syncedFromSourceSchema = z.unknown();

export const workflowTrpc = defineTrpcContract("workflow")
  /**
   * Which NLP engine is active for the project. The studio reads this to hide
   * the (now defunct) Optimize button.
   */
  .query("engineMode")
  .withInput(workflowApiEngineModeInputSchema)
  .withOutput(workflowEngineModeSchema)

  .mutation("create")
  .withInput(workflowApiCreateInputSchema)
  .withOutput(workflowWithNewVersionSchema)

  .mutation("copy")
  .withInput(workflowApiCopyInputSchema)
  .withOutput(workflowWithNewVersionSchema)

  .query("getAll")
  .withInput(workflowApiProjectInputSchema)
  .withOutput(workflowListRowSchema.array())

  .query("getCopies")
  .withInput(workflowApiWorkflowInputSchema)
  .withOutput(workflowCopyRowSchema.array())

  .query("getById")
  .withInput(workflowApiGetByIdInputSchema)
  .withOutput(workflowWithVersionSchema)

  .query("getVersions")
  .withInput(workflowApiGetVersionsInputSchema)
  .withOutput(workflowVersionHistoryEntrySchema.array())

  .mutation("restoreVersion")
  .withInput(workflowApiRestoreVersionInputSchema)
  .withOutput(workflowVersionSchema)

  .mutation("autosave")
  .withInput(workflowApiAutosaveInputSchema)
  .withOutput(workflowVersionSchema)

  .mutation("commitVersion")
  .withInput(workflowApiCommitVersionInputSchema)
  .withOutput(workflowVersionSchema)

  .mutation("publish")
  .withInput(workflowApiPublishInputSchema)
  .withOutput(workflowSchema)

  .mutation("unpublish")
  .withInput(workflowApiWorkflowInputSchema)
  .withOutput(workflowSchema)

  .mutation("syncFromSource")
  .withInput(workflowApiWorkflowInputSchema)
  .withOutput(syncedFromSourceSchema)

  .mutation("pushToCopies")
  .withInput(workflowApiPushToCopiesInputSchema)
  .withOutput(workflowPushToCopiesSchema)

  .query("getRelatedEntities")
  .withInput(workflowApiWorkflowInputSchema)
  .withOutput(workflowRelatedEntitiesSchema)

  .mutation("cascadeArchive")
  .withInput(workflowApiArchiveInputSchema)
  .withOutput(workflowCascadeArchiveSchema)

  .mutation("archive")
  .withInput(workflowApiArchiveInputSchema)
  .withOutput(workflowSchema)

  .mutation("generateCommitMessage")
  .withInput(workflowApiGenerateCommitMessageInputSchema)
  .withOutput(z.string())
  .build();
