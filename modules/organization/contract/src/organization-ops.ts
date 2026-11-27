import type { Named } from "@langwatch/module";
import { z } from "zod";

/**
 * One organization as a staff investigation reads it (ADR-202, ops functions): ids, counts and
 * a creation time in epoch milliseconds. No names, slugs or addresses.
 */
const organizationOpsSnapshotSchemaDefinition = z
  .object({
    organizationId: z.string(),
    createdAt: z.number().int().nonnegative(),
    membersCount: z.number().int().nonnegative(),
    pendingInvitesCount: z.number().int().nonnegative(),
    teamsCount: z.number().int().nonnegative(),
    projectIds: z.array(z.string()),
  })
  .strict();
export interface OrganizationOpsSnapshotSchema extends Named<
  typeof organizationOpsSnapshotSchemaDefinition
> {}
export const organizationOpsSnapshotSchema: OrganizationOpsSnapshotSchema =
  organizationOpsSnapshotSchemaDefinition;
export type OrganizationOpsSnapshot = z.infer<typeof organizationOpsSnapshotSchema>;

/**
 * One invitation as a staff investigation reads it (ADR-202, ops functions): every status, ids,
 * flags and epoch-millisecond times. Never the address, the code or the accept link.
 */
const organizationInviteFactSchemaDefinition = z
  .object({
    inviteId: z.string(),
    role: z.enum(["ADMIN", "MEMBER", "EXTERNAL", "DEVELOPER"]),
    status: z.enum([
      "PENDING",
      "ACCEPTED",
      "EXPIRED",
      "REVOKED",
      "WAITING_APPROVAL",
      "PAYMENT_PENDING",
    ]),
    billingOnly: z.boolean(),
    /** Held for a seat checkout until it is paid. */
    viaCheckout: z.boolean(),
    teamIds: z.array(z.string()),
    requestedByUserId: z.string().nullable(),
    acceptedByUserId: z.string().nullable(),
    createdAt: z.number().int().nonnegative(),
    updatedAt: z.number().int().nonnegative(),
    expiresAt: z.number().int().nullable(),
  })
  .strict();
export interface OrganizationInviteFactSchema extends Named<
  typeof organizationInviteFactSchemaDefinition
> {}
export const organizationInviteFactSchema: OrganizationInviteFactSchema =
  organizationInviteFactSchemaDefinition;
export type OrganizationInviteFact = z.infer<typeof organizationInviteFactSchema>;
