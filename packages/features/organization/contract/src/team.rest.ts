/**
 * The wire shapes the `/api/teams` REST family publishes.
 *
 * The team it answers is narrower than the stored one: the personal-workspace
 * flags and the archive stamp are the app's business, not a management
 * client's, and the door has never sent them.
 */
import { z } from "zod";

import { organizationTeamMemberRoleSchema, organizationTeamSchema } from "./team.ts";

export const organizationTeamRestSchema = organizationTeamSchema.omit({
  isPersonal: true,
  ownerUserId: true,
  archivedAt: true,
});
export type OrganizationTeamRest = z.infer<typeof organizationTeamRestSchema>;

export const organizationTeamRestPageSchema = z.object({
  data: z.array(organizationTeamRestSchema),
  pagination: z.object({
    page: z.number().int().positive(),
    limit: z.number().int().positive(),
    total: z.number().int().nonnegative(),
  }),
});

/** What archiving a team answers: the team it archived, and when. */
export const organizationTeamRestArchivedSchema = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  archivedAt: z.date().nullable(),
});

/** One team member, with the role their binding grants at the team. */
export const organizationTeamRestMemberSchema = z.object({
  userId: z.string().min(1),
  name: z.string().nullable(),
  email: z.string().nullable(),
  role: organizationTeamMemberRoleSchema,
});

export const organizationTeamRestMemberListSchema = z.object({
  data: z.array(organizationTeamRestMemberSchema),
});
