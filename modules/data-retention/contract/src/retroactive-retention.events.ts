/**
 * Applying a retention change to stored rows, as data-retention's own facts: the api records the
 * request, the worker runs the rewrite and records its progress (ADR-202 Decided 13).
 * Spec: modules/data-retention/specs/retroactive-retention-via-worker.feature
 */
import type { Named } from "@langwatch/module";
import { z } from "zod";

import { retentionCategorySchema, retroactiveMutationProgressSchema } from "./data-retention.ts";

export const RETROACTIVE_RETENTION_PIPELINE_NAME = "data_retention_retroactive" as const;
export const RETROACTIVE_RETENTION_AGGREGATE_TYPE = "retroactive_retention" as const;
export const RETROACTIVE_RETENTION_EVENT_VERSION = "2026-11-14" as const;

export const RETROACTIVE_APPLY_REQUESTED_EVENT_TYPE =
  "lw.data_retention.retroactive_apply_requested" as const;
export const RETROACTIVE_CANCEL_REQUESTED_EVENT_TYPE =
  "lw.data_retention.retroactive_cancel_requested" as const;
export const RETROACTIVE_PROGRESS_RECORDED_EVENT_TYPE =
  "lw.data_retention.retroactive_progress_recorded" as const;

export const REQUEST_RETROACTIVE_APPLY_COMMAND_TYPE =
  "lw.data_retention.request_retroactive_apply" as const;
export const REQUEST_RETROACTIVE_CANCEL_COMMAND_TYPE =
  "lw.data_retention.request_retroactive_cancel" as const;
export const RECORD_RETROACTIVE_PROGRESS_COMMAND_TYPE =
  "lw.data_retention.record_retroactive_progress" as const;

/** What makes the progress read stale: every fact this pipeline records. */
export const RETROACTIVE_RETENTION_EVENT_TYPES = [
  RETROACTIVE_APPLY_REQUESTED_EVENT_TYPE,
  RETROACTIVE_CANCEL_REQUESTED_EVENT_TYPE,
  RETROACTIVE_PROGRESS_RECORDED_EVENT_TYPE,
] as const;

/** An accepted apply not yet started answers under this prefix, so Cancel can name it. */
export const PENDING_RETROACTIVE_APPLY_PREFIX = "pending:" as const;
/** An apply the worker gave up on answers under this prefix; Cancel on it dismisses it. */
export const FAILED_RETROACTIVE_APPLY_PREFIX = "failed:" as const;
/** What the panel shows for an apply the worker gave up on: customer-safe, no store detail. */
export const RETROACTIVE_APPLY_FAILURE_MESSAGE =
  "Applying this retention change to existing data failed. Apply it again to retry." as const;

/** One running rewrite as the worker recorded it: `partsTotal` is the most parts it had to do. */
const retroactiveMutationRecordSchemaDefinition = retroactiveMutationProgressSchema
  .omit({ progressPercent: true, failure: true })
  .safeExtend({ partsTotal: z.number().nonnegative() });
export interface RetroactiveMutationRecordSchema extends Named<
  typeof retroactiveMutationRecordSchemaDefinition
> {}
export const retroactiveMutationRecordSchema: RetroactiveMutationRecordSchema =
  retroactiveMutationRecordSchemaDefinition;
export type RetroactiveMutationRecord = z.infer<typeof retroactiveMutationRecordSchema>;

const retroactiveApplyRequestedDataSchemaDefinition = z
  .object({
    projectId: z.string().min(1),
    requestId: z.string().min(1),
    category: retentionCategorySchema,
    retentionDays: z.number().int().positive(),
    requestedByUserId: z.string().min(1),
  })
  .strict();
export interface RetroactiveApplyRequestedDataSchema extends Named<
  typeof retroactiveApplyRequestedDataSchemaDefinition
> {}
export const retroactiveApplyRequestedDataSchema: RetroactiveApplyRequestedDataSchema =
  retroactiveApplyRequestedDataSchemaDefinition;
export type RetroactiveApplyRequestedData = z.infer<typeof retroactiveApplyRequestedDataSchema>;

const retroactiveCancelRequestedDataSchemaDefinition = z
  .object({
    projectId: z.string().min(1),
    requestId: z.string().min(1),
    /** A ClickHouse mutation id, or `pending:<requestId>` for an apply not yet started. */
    mutationId: z.string().min(1),
    requestedByUserId: z.string().min(1),
  })
  .strict();
export interface RetroactiveCancelRequestedDataSchema extends Named<
  typeof retroactiveCancelRequestedDataSchemaDefinition
> {}
export const retroactiveCancelRequestedDataSchema: RetroactiveCancelRequestedDataSchema =
  retroactiveCancelRequestedDataSchemaDefinition;
export type RetroactiveCancelRequestedData = z.infer<typeof retroactiveCancelRequestedDataSchema>;

const retroactiveProgressRecordedDataSchemaDefinition = z
  .object({
    projectId: z.string().min(1),
    /** The rewrites still running, as the worker read them. */
    mutations: z.array(retroactiveMutationRecordSchema),
    /** The apply this record closes: started, already running, or given up on. */
    settled: z
      .object({
        requestId: z.string().min(1),
        outcome: z.enum(["started", "already_running", "failed"]),
      })
      .strict()
      .nullable(),
  })
  .strict();
export interface RetroactiveProgressRecordedDataSchema extends Named<
  typeof retroactiveProgressRecordedDataSchemaDefinition
> {}
export const retroactiveProgressRecordedDataSchema: RetroactiveProgressRecordedDataSchema =
  retroactiveProgressRecordedDataSchemaDefinition;
export type RetroactiveProgressRecordedData = z.infer<typeof retroactiveProgressRecordedDataSchema>;
