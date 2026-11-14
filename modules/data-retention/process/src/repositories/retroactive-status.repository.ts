import {
  retentionCategorySchema,
  retroactiveMutationRecordSchema,
} from "@langwatch/data-retention-contract";
import { z } from "zod";

/** An apply the api accepted and the worker has not yet started or given up on. */
export const pendingRetroactiveApplySchema = z
  .object({
    requestId: z.string().min(1),
    category: retentionCategorySchema,
    retentionDays: z.number().int().positive(),
    requestedAt: z.number().int().nonnegative(),
  })
  .strict();

/** An apply the worker gave up on, kept until dismissed or the category is applied again. */
export const failedRetroactiveApplySchema = z
  .object({
    requestId: z.string().min(1),
    category: retentionCategorySchema,
    failedAt: z.number().int().nonnegative(),
  })
  .strict();

/** The rewrites one apply's intent issued so far: a redelivery issues only the rest. */
export const issuedRetroactiveTargetsSchema = z
  .object({ requestId: z.string().min(1), targets: z.array(z.string().min(1)) })
  .strict();

/**
 * One project's retroactive retention status (ADR-202 Decided 13). The worker's fold writes every
 * field but `issued`, which only the apply intent writes. `lastAppliedEventId` is the row's
 * version (record §9, durable receivers).
 */
export const retroactiveStatusSchema = z
  .object({
    projectId: z.string().min(1),
    pending: z.array(pendingRetroactiveApplySchema),
    mutations: z.array(retroactiveMutationRecordSchema),
    failed: z.array(failedRetroactiveApplySchema),
    /** Applies started, cancelled or given up on, newest last, so a redelivery starts nothing. */
    closedRequestIds: z.array(z.string().min(1)),
    issued: z.array(issuedRetroactiveTargetsSchema),
    /** Empty until the first fact lands. */
    lastAppliedEventId: z.string(),
  })
  .strict();

export type PendingRetroactiveApply = z.infer<typeof pendingRetroactiveApplySchema>;
export type IssuedRetroactiveTargets = z.infer<typeof issuedRetroactiveTargetsSchema>;
export type RetroactiveStatus = z.infer<typeof retroactiveStatusSchema>;

export interface RetroactiveStatusRepository {
  /** The project's status, or an empty one when nothing was ever applied. */
  getForProject(input: { projectId: string }): Promise<RetroactiveStatus>;
  /** Writes the fold's fields; the issued targets stay as the apply intent left them. */
  save(status: RetroactiveStatus): Promise<void>;
  /** Writes the issued targets alone (the apply intent, between rewrites). */
  saveIssued(input: { projectId: string; issued: IssuedRetroactiveTargets[] }): Promise<void>;
}
