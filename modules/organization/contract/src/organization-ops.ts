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
