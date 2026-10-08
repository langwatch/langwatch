/**
 * How colleagues on a matching domain get into an organization, in the columns
 * organization owns; identity's join ledger reads and writes it through
 * OrganizationApi. Keep in step with `modules/identity/contract/src/join-matching.ts`.
 */
import { z } from "zod";

export const organizationJoinSettingSchema = z
  .object({
    domainJoin: z.enum(["off", "request", "auto"]),
    joinDomains: z.array(z.string()),
    joinerRole: z.enum(["MEMBER", "DEVELOPER"]),
  })
  .strict();
export type OrganizationJoinSetting = z.infer<typeof organizationJoinSettingSchema>;

/** Where a join request was made (ADR-171 v6), written on a Developer admission's audit row. */
export const organizationJoinOriginSchema = z.enum(["web", "cli"]);
export type OrganizationJoinOrigin = z.infer<typeof organizationJoinOriginSchema>;
