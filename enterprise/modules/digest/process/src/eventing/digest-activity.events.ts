// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/** The digest's own facts: bounded numbers and ids an owner's event contributed to a week. */
import { EventSchema } from "@langwatch/eventing";
import { z } from "zod";

export const DIGEST_PIPELINE_NAME = "digest" as const;
export const DIGEST_WEEK_AGGREGATE_TYPE = "digest_week" as const;
export const DIGEST_EVENT_VERSION = "2026-09-30" as const;
export const PROJECT_ACTIVITY_RECORDED_EVENT_TYPE = "lw.digest.project_activity_recorded" as const;
export const USER_ACTIVITY_RECORDED_EVENT_TYPE = "lw.digest.user_activity_recorded" as const;
export const RECORD_PROJECT_ACTIVITY_COMMAND_TYPE = "lw.digest.record_project_activity" as const;
export const RECORD_USER_ACTIVITY_COMMAND_TYPE = "lw.digest.record_user_activity" as const;

/** A burst of one week's facts drains as one batched append (ADR-056's coalescing). */
export const DIGEST_ACTIVITY_COALESCE_MAX_BATCH = 256;

const outcomeSchema = z.enum(["passed", "failed", "other"]);

const envelope = {
  tenantId: z.string().min(1),
  occurredAt: z.number().int().nonnegative(),
  organizationId: z.string().min(1),
  isoWeek: z.string().min(1),
  /** The owner's fact this came from; a redelivery carries the same key and folds once. */
  sourceKey: z.string().min(1),
};

export const projectActivitySchema = z.object({
  ...envelope,
  projectId: z.string().min(1),
  fact: z.discriminatedUnion("kind", [
    z.object({
      kind: z.literal("span"),
      root: z.boolean(),
      error: z.boolean(),
      tokens: z.number().nonnegative(),
      costUsd: z.number().nonnegative(),
      durationMs: z.number().nonnegative(),
      model: z.string().nullable(),
    }),
    z.object({
      kind: z.literal("evaluation"),
      evaluatorType: z.string().nullable(),
      outcome: outcomeSchema,
    }),
    z.object({
      kind: z.literal("scenario"),
      scenarioId: z.string().nullable(),
      outcome: outcomeSchema,
    }),
    z.object({ kind: z.literal("suiteItem"), outcome: outcomeSchema }),
  ]),
});
export type ProjectActivity = z.infer<typeof projectActivitySchema>;
export type ProjectFact = ProjectActivity["fact"];

export const userActivitySchema = z.object({
  ...envelope,
  userId: z.string().min(1),
  sessionId: z.string().min(1),
  repository: z.string().nullable(),
  /** One metric series' converged total (replaces, never adds), or none for a span fact. */
  series: z
    .object({
      seriesId: z.string().min(1),
      metric: z.string().min(1),
      type: z.string().nullable(),
      value: z.number(),
    })
    .nullable(),
});
export type UserActivity = z.infer<typeof userActivitySchema>;

export const projectActivityRecordedEventSchema = z.object({
  ...EventSchema.shape,
  type: z.literal(PROJECT_ACTIVITY_RECORDED_EVENT_TYPE),
  version: z.literal(DIGEST_EVENT_VERSION),
  data: projectActivitySchema,
});
export type ProjectActivityRecordedEvent = z.infer<typeof projectActivityRecordedEventSchema>;

export const userActivityRecordedEventSchema = z.object({
  ...EventSchema.shape,
  type: z.literal(USER_ACTIVITY_RECORDED_EVENT_TYPE),
  version: z.literal(DIGEST_EVENT_VERSION),
  data: userActivitySchema,
});
export type UserActivityRecordedEvent = z.infer<typeof userActivityRecordedEventSchema>;

export type DigestEvent = ProjectActivityRecordedEvent | UserActivityRecordedEvent;

export const projectWeekKey = ({ projectId, isoWeek }: { projectId: string; isoWeek: string }) =>
  `project:${projectId}:${isoWeek}`;
export const userWeekKey = ({ userId, isoWeek }: { userId: string; isoWeek: string }) =>
  `user:${userId}:${isoWeek}`;
