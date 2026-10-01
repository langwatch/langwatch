import { z } from "zod";

/** A project's lifecycle facts, which peers react to from their own side (§9). */
export const PROJECT_LIFECYCLE_PIPELINE_NAME = "project_lifecycle" as const;
export const PROJECT_AGGREGATE_TYPE = "project" as const;
export const PROJECT_CREATED_EVENT_TYPE = "lw.project.created" as const;
export const PROJECT_CREATED_EVENT_VERSION = "2026-09-30" as const;

/** Ids only: a peer reads anything else it needs through `ProjectApi`, never from the event. */
export const projectCreatedEventDataSchema = z.object({
  tenantId: z.string().min(1),
  projectId: z.string().min(1),
  organizationId: z.string().min(1),
  occurredAt: z.number().int().nonnegative(),
  /** The organization's live ADMIN member when recorded, as `resolveOrgAdmin` picks it. */
  adminUserId: z.string().min(1).nullish(),
  /** The person who created it; absent for a personal workspace's project and a backfill. */
  createdByUserId: z.string().min(1).nullish(),
  /** Set by project's backfill: the project existed before its creation was recorded. */
  backfilled: z.boolean().optional(),
});
export type ProjectCreatedEventData = z.infer<typeof projectCreatedEventDataSchema>;

export const PROJECT_LEGACY_KEY_REVOKED_EVENT_TYPE = "lw.project.legacy_key_revoked" as const;
export const PROJECT_LEGACY_KEY_REVOKED_EVENT_VERSION = "2026-10-01" as const;

/** Ids only: the key, or any part of it, is never an event's data. */
export const projectLegacyKeyRevokedEventDataSchema = z.object({
  tenantId: z.string().min(1),
  projectId: z.string().min(1),
  organizationId: z.string().min(1),
  occurredAt: z.number().int().nonnegative(),
  revokedByUserId: z.string().min(1),
});
export type ProjectLegacyKeyRevokedEventData = z.infer<
  typeof projectLegacyKeyRevokedEventDataSchema
>;
