import { z } from "zod";

export const ORGANIZATION_PRESENCE_SETTING_CHANGED_EVENT_TYPE =
  "lw.organization.presence_setting_changed" as const;
export const ORGANIZATION_PRESENCE_SETTING_CHANGED_EVENT_VERSION = "2026-10-05" as const;

/** The organization's presence switch; presence ANDs it with a project's. */
export const organizationPresenceSettingChangedEventDataSchema = z.object({
  tenantId: z.string().min(1),
  organizationId: z.string().min(1),
  occurredAt: z.number().int().nonnegative(),
  presenceEnabled: z.boolean(),
  /** Who saved the change; absent for a backfill or an organization key with no member. */
  changedByUserId: z.string().min(1).nullish(),
  /** Set by organization's backfill: the stored value, recorded before any change was. */
  backfilled: z.boolean().optional(),
});
export type OrganizationPresenceSettingChangedEventData = z.infer<
  typeof organizationPresenceSettingChangedEventDataSchema
>;

export const ORGANIZATION_TRACE_SHARING_DISABLED_EVENT_TYPE =
  "lw.organization.trace_sharing_disabled" as const;
export const ORGANIZATION_TRACE_SHARING_DISABLED_EVENT_VERSION = "2026-10-07" as const;

/** Trace sharing switched off; share revokes the links of `projectIds` on its side (§9, R7). */
export const organizationTraceSharingDisabledEventDataSchema = z.object({
  tenantId: z.string().min(1),
  organizationId: z.string().min(1),
  occurredAt: z.number().int().nonnegative(),
  /** The organization's projects, read when the setting was saved. */
  projectIds: z.array(z.string().min(1)),
  /** Who saved the change; absent for an organization key with no member. */
  changedByUserId: z.string().min(1).nullish(),
});
export type OrganizationTraceSharingDisabledEventData = z.infer<
  typeof organizationTraceSharingDisabledEventDataSchema
>;
