/**
 * The wire shapes the `/api/teams` REST family publishes — narrower than the
 * stored team: the personal-workspace flags and archive stamp are the app's
 * business, not a management client's, and the door never sends them.
 */
import { z } from "zod";

import {
  organizationTeamMemberRoleSchema,
  organizationTeamRoleSchema,
  organizationTeamSchema,
} from "./team.ts";

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

/** Page and page size a collection route reads off the query string. */
export const organizationTeamRestPaginationQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().positive().max(1000).optional().default(50),
});

/** The body a create takes: a name, and nothing else. */
export const organizationTeamRestCreateSchema = z.object({
  name: z.string().min(1, "name is required").max(255),
});

/** The body a rename takes. A PATCH here never touches membership. */
export const organizationTeamRestUpdateSchema = z.object({
  name: z.string().min(1).max(255).optional(),
});

/** The body that adds one member to a team, at a role. */
export const organizationTeamRestAddMemberSchema = z.object({
  userId: z.string().min(1, "userId is required"),
  role: organizationTeamRoleSchema.optional().default("MEMBER"),
});

/** The path a route addressing one team carries. */
export const organizationTeamRestParamsSchema = z.object({ teamId: z.string().min(1) });

/** The path a route addressing one member of one team carries. */
export const organizationTeamRestMemberParamsSchema = z.object({
  ...organizationTeamRestParamsSchema.shape,
  userId: z.string().min(1),
});

/** What a route answers when the whole of its answer is that it worked. */
export const organizationTeamRestSuccessSchema = z.object({ success: z.boolean() });

/** The projects of one team, as the door lists them. */
export const organizationTeamRestProjectListSchema = z.object({ data: z.array(z.unknown()) });
