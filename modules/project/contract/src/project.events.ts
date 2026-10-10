import type { Named } from "@langwatch/module";
import { z } from "zod";

/** A project's lifecycle facts, which peers react to from their own side (§9). */
export const PROJECT_LIFECYCLE_PIPELINE_NAME = "project_lifecycle" as const;
export const PROJECT_AGGREGATE_TYPE = "project" as const;
export const PROJECT_CREATED_EVENT_TYPE = "lw.project.created" as const;
export const PROJECT_CREATED_EVENT_VERSION = "2026-09-30" as const;

/** Ids and placement only: a peer reads anything else through `ProjectApi`, never the event. */
const projectCreatedEventDataSchemaDefinition = z.object({
  tenantId: z.string().min(1),
  projectId: z.string().min(1),
  organizationId: z.string().min(1),
  occurredAt: z.number().int().nonnegative(),
  /** The organization's live ADMIN member when recorded, as `resolveOrgAdmin` picks it. */
  adminUserId: z.string().min(1).nullish(),
  /** The person who created it; absent for a personal workspace's project and a backfill. */
  createdByUserId: z.string().min(1).nullish(),
  /** Where the project sits when created; absent on facts recorded before 2026-10-06. */
  teamId: z.string().min(1).optional(),
  isPersonal: z.boolean().optional(),
  /** Set by project's backfill: the project existed before its creation was recorded. */
  backfilled: z.boolean().optional(),
});
export interface ProjectCreatedEventDataSchema extends Named<
  typeof projectCreatedEventDataSchemaDefinition
> {}
export const projectCreatedEventDataSchema: ProjectCreatedEventDataSchema =
  projectCreatedEventDataSchemaDefinition;
export type ProjectCreatedEventData = z.infer<typeof projectCreatedEventDataSchema>;

export const PROJECT_LEGACY_KEY_REVOKED_EVENT_TYPE = "lw.project.legacy_key_revoked" as const;
export const PROJECT_LEGACY_KEY_REVOKED_EVENT_VERSION = "2026-10-01" as const;

/** Ids only: the key, or any part of it, is never an event's data. */
const projectLegacyKeyRevokedEventDataSchemaDefinition = z.object({
  tenantId: z.string().min(1),
  projectId: z.string().min(1),
  organizationId: z.string().min(1),
  occurredAt: z.number().int().nonnegative(),
  revokedByUserId: z.string().min(1),
});
export interface ProjectLegacyKeyRevokedEventDataSchema extends Named<
  typeof projectLegacyKeyRevokedEventDataSchemaDefinition
> {}
export const projectLegacyKeyRevokedEventDataSchema: ProjectLegacyKeyRevokedEventDataSchema =
  projectLegacyKeyRevokedEventDataSchemaDefinition;
export type ProjectLegacyKeyRevokedEventData = z.infer<
  typeof projectLegacyKeyRevokedEventDataSchema
>;

export const PROJECT_PRESENCE_SETTING_CHANGED_EVENT_TYPE =
  "lw.project.presence_setting_changed" as const;
export const PROJECT_PRESENCE_SETTING_CHANGED_EVENT_VERSION = "2026-10-05" as const;

/** The project's own presence switch; presence ANDs it with its organization's. */
const projectPresenceSettingChangedEventDataSchemaDefinition = z.object({
  tenantId: z.string().min(1),
  projectId: z.string().min(1),
  organizationId: z.string().min(1),
  occurredAt: z.number().int().nonnegative(),
  presenceEnabled: z.boolean(),
  /** Who saved the change; absent for a backfill. */
  changedByUserId: z.string().min(1).nullish(),
  /** Set by project's backfill: the stored value, recorded before any change was. */
  backfilled: z.boolean().optional(),
});
export interface ProjectPresenceSettingChangedEventDataSchema extends Named<
  typeof projectPresenceSettingChangedEventDataSchemaDefinition
> {}
export const projectPresenceSettingChangedEventDataSchema: ProjectPresenceSettingChangedEventDataSchema =
  projectPresenceSettingChangedEventDataSchemaDefinition;
export type ProjectPresenceSettingChangedEventData = z.infer<
  typeof projectPresenceSettingChangedEventDataSchema
>;

export const PROJECT_MOVED_EVENT_TYPE = "lw.project.moved" as const;
export const PROJECT_MOVED_EVENT_VERSION = "2026-10-06" as const;

/** A project now sits under another team of the same organization; ids only. */
const projectMovedEventDataSchemaDefinition = z.object({
  tenantId: z.string().min(1),
  projectId: z.string().min(1),
  organizationId: z.string().min(1),
  occurredAt: z.number().int().nonnegative(),
  fromTeamId: z.string().min(1),
  toTeamId: z.string().min(1),
});
export interface ProjectMovedEventDataSchema extends Named<
  typeof projectMovedEventDataSchemaDefinition
> {}
export const projectMovedEventDataSchema: ProjectMovedEventDataSchema =
  projectMovedEventDataSchemaDefinition;
export type ProjectMovedEventData = z.infer<typeof projectMovedEventDataSchema>;

export const PROJECT_ARCHIVED_EVENT_TYPE = "lw.project.archived" as const;
export const PROJECT_ARCHIVED_EVENT_VERSION = "2026-10-06" as const;

/** A project was archived and no longer resolves as a scope; ids only. */
const projectArchivedEventDataSchemaDefinition = z.object({
  tenantId: z.string().min(1),
  projectId: z.string().min(1),
  organizationId: z.string().min(1),
  occurredAt: z.number().int().nonnegative(),
});
export interface ProjectArchivedEventDataSchema extends Named<
  typeof projectArchivedEventDataSchemaDefinition
> {}
export const projectArchivedEventDataSchema: ProjectArchivedEventDataSchema =
  projectArchivedEventDataSchemaDefinition;
export type ProjectArchivedEventData = z.infer<typeof projectArchivedEventDataSchema>;

export const PROJECT_DEPARTMENT_ASSIGNED_EVENT_TYPE = "lw.project.department_assigned" as const;
export const PROJECT_DEPARTMENT_ASSIGNED_EVENT_VERSION = "2026-10-06" as const;

/** A project's department, with its team and personal flag as they stood when it was recorded. */
const projectDepartmentAssignedEventDataSchemaDefinition = z.object({
  tenantId: z.string().min(1),
  projectId: z.string().min(1),
  organizationId: z.string().min(1),
  occurredAt: z.number().int().nonnegative(),
  departmentId: z.string().min(1).nullable(),
  teamId: z.string().min(1),
  isPersonal: z.boolean(),
  /** Set by project's backfill: the stored department, recorded before any change was. */
  backfilled: z.boolean().optional(),
});
export interface ProjectDepartmentAssignedEventDataSchema extends Named<
  typeof projectDepartmentAssignedEventDataSchemaDefinition
> {}
export const projectDepartmentAssignedEventDataSchema: ProjectDepartmentAssignedEventDataSchema =
  projectDepartmentAssignedEventDataSchemaDefinition;
export type ProjectDepartmentAssignedEventData = z.infer<
  typeof projectDepartmentAssignedEventDataSchema
>;

export const PROJECT_TRACE_SHARING_DISABLED_EVENT_TYPE =
  "lw.project.trace_sharing_disabled" as const;
export const PROJECT_TRACE_SHARING_DISABLED_EVENT_VERSION = "2026-10-07" as const;

/** A project's trace sharing was switched off; share revokes its links from its own side (R7). */
const projectTraceSharingDisabledEventDataSchemaDefinition = z.object({
  tenantId: z.string().min(1),
  projectId: z.string().min(1),
  organizationId: z.string().min(1),
  occurredAt: z.number().int().nonnegative(),
  disabledByUserId: z.string().min(1),
  /** Absent on facts recorded before the choice existed; absent means revoke. */
  revokeExistingLinks: z.boolean().optional(),
});
export interface ProjectTraceSharingDisabledEventDataSchema extends Named<
  typeof projectTraceSharingDisabledEventDataSchemaDefinition
> {}
export const projectTraceSharingDisabledEventDataSchema: ProjectTraceSharingDisabledEventDataSchema =
  projectTraceSharingDisabledEventDataSchemaDefinition;
export type ProjectTraceSharingDisabledEventData = z.infer<
  typeof projectTraceSharingDisabledEventDataSchema
>;

export const PROJECT_AGGREGATE_RULE_CHANGED_EVENT_TYPE =
  "lw.project.aggregate_rule_changed" as const;
export const PROJECT_AGGREGATE_RULE_CHANGED_EVENT_VERSION = "2026-10-09" as const;

/** A live aggregate's rule was replaced; ids only, governance reads it through `ProjectApi`. */
const projectAggregateRuleChangedEventDataSchemaDefinition = z.object({
  tenantId: z.string().min(1),
  projectId: z.string().min(1),
  organizationId: z.string().min(1),
  occurredAt: z.number().int().nonnegative(),
  changedByUserId: z.string().min(1),
});
export interface ProjectAggregateRuleChangedEventDataSchema extends Named<
  typeof projectAggregateRuleChangedEventDataSchemaDefinition
> {}
export const projectAggregateRuleChangedEventDataSchema: ProjectAggregateRuleChangedEventDataSchema =
  projectAggregateRuleChangedEventDataSchemaDefinition;
export type ProjectAggregateRuleChangedEventData = z.infer<
  typeof projectAggregateRuleChangedEventDataSchema
>;

export const PROJECT_REVIVED_EVENT_TYPE = "lw.project.revived" as const;
export const PROJECT_REVIVED_EVENT_VERSION = "2026-10-09" as const;

/** An archived personal project is live again with its revived workspace; ids only. */
const projectRevivedEventDataSchemaDefinition = z.object({
  tenantId: z.string().min(1),
  projectId: z.string().min(1),
  organizationId: z.string().min(1),
  occurredAt: z.number().int().nonnegative(),
});
export interface ProjectRevivedEventDataSchema extends Named<
  typeof projectRevivedEventDataSchemaDefinition
> {}
export const projectRevivedEventDataSchema: ProjectRevivedEventDataSchema =
  projectRevivedEventDataSchemaDefinition;
export type ProjectRevivedEventData = z.infer<typeof projectRevivedEventDataSchema>;
