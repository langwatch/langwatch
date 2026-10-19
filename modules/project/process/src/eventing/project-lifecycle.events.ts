import { EventSchema } from "@langwatch/eventing";
import {
  PROJECT_CREATED_EVENT_TYPE,
  PROJECT_CREATED_EVENT_VERSION,
  PROJECT_LEGACY_KEY_REVOKED_EVENT_TYPE,
  PROJECT_LEGACY_KEY_REVOKED_EVENT_VERSION,
  PROJECT_PRESENCE_SETTING_CHANGED_EVENT_TYPE,
  PROJECT_PRESENCE_SETTING_CHANGED_EVENT_VERSION,
  PROJECT_MOVED_EVENT_TYPE,
  PROJECT_MOVED_EVENT_VERSION,
  PROJECT_ARCHIVED_EVENT_TYPE,
  PROJECT_ARCHIVED_EVENT_VERSION,
  PROJECT_DEPARTMENT_ASSIGNED_EVENT_TYPE,
  PROJECT_DEPARTMENT_ASSIGNED_EVENT_VERSION,
  projectArchivedEventDataSchema,
  projectDepartmentAssignedEventDataSchema,
  projectMovedEventDataSchema,
  projectCreatedEventDataSchema,
  projectLegacyKeyRevokedEventDataSchema,
  projectPresenceSettingChangedEventDataSchema,
  projectTraceSharingDisabledEventDataSchema,
  PROJECT_TRACE_SHARING_DISABLED_EVENT_TYPE,
  PROJECT_TRACE_SHARING_DISABLED_EVENT_VERSION,
  PROJECT_AGGREGATE_RULE_CHANGED_EVENT_TYPE,
  PROJECT_AGGREGATE_RULE_CHANGED_EVENT_VERSION,
  PROJECT_REVIVED_EVENT_TYPE,
  PROJECT_REVIVED_EVENT_VERSION,
  projectAggregateRuleChangedEventDataSchema,
  projectRevivedEventDataSchema,
} from "@langwatch/project-contract";
import { z } from "zod";

export const RECORD_PROJECT_CREATED_COMMAND_TYPE = "lw.project.record_created" as const;

export const recordProjectCreatedCommandDataSchema = projectCreatedEventDataSchema;
export type RecordProjectCreatedCommandData = z.infer<typeof recordProjectCreatedCommandDataSchema>;

export const projectCreatedEventSchema = z.object({
  ...EventSchema.shape,
  type: z.literal(PROJECT_CREATED_EVENT_TYPE),
  version: z.literal(PROJECT_CREATED_EVENT_VERSION),
  data: projectCreatedEventDataSchema,
});
export type ProjectCreatedEvent = z.infer<typeof projectCreatedEventSchema>;

export const RECORD_PROJECT_LEGACY_KEY_REVOKED_COMMAND_TYPE =
  "lw.project.record_legacy_key_revoked" as const;

export const recordProjectLegacyKeyRevokedCommandDataSchema =
  projectLegacyKeyRevokedEventDataSchema;
export type RecordProjectLegacyKeyRevokedCommandData = z.infer<
  typeof recordProjectLegacyKeyRevokedCommandDataSchema
>;

export const projectLegacyKeyRevokedEventSchema = z.object({
  ...EventSchema.shape,
  type: z.literal(PROJECT_LEGACY_KEY_REVOKED_EVENT_TYPE),
  version: z.literal(PROJECT_LEGACY_KEY_REVOKED_EVENT_VERSION),
  data: projectLegacyKeyRevokedEventDataSchema,
});
export type ProjectLegacyKeyRevokedEvent = z.infer<typeof projectLegacyKeyRevokedEventSchema>;

export const RECORD_PROJECT_PRESENCE_SETTING_CHANGED_COMMAND_TYPE =
  "lw.project.record_presence_setting_changed" as const;

export const recordProjectPresenceSettingChangedCommandDataSchema =
  projectPresenceSettingChangedEventDataSchema;
export type RecordProjectPresenceSettingChangedCommandData = z.infer<
  typeof recordProjectPresenceSettingChangedCommandDataSchema
>;

export const projectPresenceSettingChangedEventSchema = z.object({
  ...EventSchema.shape,
  type: z.literal(PROJECT_PRESENCE_SETTING_CHANGED_EVENT_TYPE),
  version: z.literal(PROJECT_PRESENCE_SETTING_CHANGED_EVENT_VERSION),
  data: projectPresenceSettingChangedEventDataSchema,
});
export type ProjectPresenceSettingChangedEvent = z.infer<
  typeof projectPresenceSettingChangedEventSchema
>;

export const RECORD_PROJECT_MOVED_COMMAND_TYPE = "lw.project.record_moved" as const;

export const recordProjectMovedCommandDataSchema = projectMovedEventDataSchema;
export type RecordProjectMovedCommandData = z.infer<typeof recordProjectMovedCommandDataSchema>;

export const projectMovedEventSchema = z.object({
  ...EventSchema.shape,
  type: z.literal(PROJECT_MOVED_EVENT_TYPE),
  version: z.literal(PROJECT_MOVED_EVENT_VERSION),
  data: projectMovedEventDataSchema,
});
export type ProjectMovedEvent = z.infer<typeof projectMovedEventSchema>;

export const RECORD_PROJECT_ARCHIVED_COMMAND_TYPE = "lw.project.record_archived" as const;

export const recordProjectArchivedCommandDataSchema = projectArchivedEventDataSchema;
export type RecordProjectArchivedCommandData = z.infer<
  typeof recordProjectArchivedCommandDataSchema
>;

export const projectArchivedEventSchema = z.object({
  ...EventSchema.shape,
  type: z.literal(PROJECT_ARCHIVED_EVENT_TYPE),
  version: z.literal(PROJECT_ARCHIVED_EVENT_VERSION),
  data: projectArchivedEventDataSchema,
});
export type ProjectArchivedEvent = z.infer<typeof projectArchivedEventSchema>;

export const RECORD_PROJECT_DEPARTMENT_ASSIGNED_COMMAND_TYPE =
  "lw.project.record_department_assigned" as const;

export const recordProjectDepartmentAssignedCommandDataSchema =
  projectDepartmentAssignedEventDataSchema;
export type RecordProjectDepartmentAssignedCommandData = z.infer<
  typeof recordProjectDepartmentAssignedCommandDataSchema
>;

export const projectDepartmentAssignedEventSchema = z.object({
  ...EventSchema.shape,
  type: z.literal(PROJECT_DEPARTMENT_ASSIGNED_EVENT_TYPE),
  version: z.literal(PROJECT_DEPARTMENT_ASSIGNED_EVENT_VERSION),
  data: projectDepartmentAssignedEventDataSchema,
});
export type ProjectDepartmentAssignedEvent = z.infer<typeof projectDepartmentAssignedEventSchema>;

export const RECORD_PROJECT_TRACE_SHARING_DISABLED_COMMAND_TYPE =
  "lw.project.record_trace_sharing_disabled" as const;

export const recordProjectTraceSharingDisabledCommandDataSchema =
  projectTraceSharingDisabledEventDataSchema;
export type RecordProjectTraceSharingDisabledCommandData = z.infer<
  typeof recordProjectTraceSharingDisabledCommandDataSchema
>;

export const projectTraceSharingDisabledEventSchema = z.object({
  ...EventSchema.shape,
  type: z.literal(PROJECT_TRACE_SHARING_DISABLED_EVENT_TYPE),
  version: z.literal(PROJECT_TRACE_SHARING_DISABLED_EVENT_VERSION),
  data: projectTraceSharingDisabledEventDataSchema,
});
export type ProjectTraceSharingDisabledEvent = z.infer<
  typeof projectTraceSharingDisabledEventSchema
>;

export const RECORD_PROJECT_AGGREGATE_RULE_CHANGED_COMMAND_TYPE =
  "lw.project.record_aggregate_rule_changed" as const;

export const recordProjectAggregateRuleChangedCommandDataSchema =
  projectAggregateRuleChangedEventDataSchema;
export type RecordProjectAggregateRuleChangedCommandData = z.infer<
  typeof recordProjectAggregateRuleChangedCommandDataSchema
>;

export const projectAggregateRuleChangedEventSchema = z.object({
  ...EventSchema.shape,
  type: z.literal(PROJECT_AGGREGATE_RULE_CHANGED_EVENT_TYPE),
  version: z.literal(PROJECT_AGGREGATE_RULE_CHANGED_EVENT_VERSION),
  data: projectAggregateRuleChangedEventDataSchema,
});
export type ProjectAggregateRuleChangedEvent = z.infer<
  typeof projectAggregateRuleChangedEventSchema
>;

export const RECORD_PROJECT_REVIVED_COMMAND_TYPE = "lw.project.record_revived" as const;

export const recordProjectRevivedCommandDataSchema = projectRevivedEventDataSchema;
export type RecordProjectRevivedCommandData = z.infer<typeof recordProjectRevivedCommandDataSchema>;

export const projectRevivedEventSchema = z.object({
  ...EventSchema.shape,
  type: z.literal(PROJECT_REVIVED_EVENT_TYPE),
  version: z.literal(PROJECT_REVIVED_EVENT_VERSION),
  data: projectRevivedEventDataSchema,
});
export type ProjectRevivedEvent = z.infer<typeof projectRevivedEventSchema>;
