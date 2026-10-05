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
