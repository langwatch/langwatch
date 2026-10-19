import type { Named } from "@langwatch/module";
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

const organizationTeamRestSchemaDefinition = organizationTeamSchema.omit({
  isPersonal: true,
  ownerUserId: true,
  archivedAt: true,
});
export interface OrganizationTeamRestSchema extends Named<
  typeof organizationTeamRestSchemaDefinition
> {}
export const organizationTeamRestSchema: OrganizationTeamRestSchema =
  organizationTeamRestSchemaDefinition;
export type OrganizationTeamRest = z.infer<typeof organizationTeamRestSchema>;

const organizationTeamRestPageSchemaDefinition = z.object({
  data: z.array(organizationTeamRestSchema),
  pagination: z.object({
    page: z.number().int().positive(),
    limit: z.number().int().positive(),
    total: z.number().int().nonnegative(),
  }),
});
export interface OrganizationTeamRestPageSchema extends Named<
  typeof organizationTeamRestPageSchemaDefinition
> {}
export const organizationTeamRestPageSchema: OrganizationTeamRestPageSchema =
  organizationTeamRestPageSchemaDefinition;

/** What archiving a team answers: the team it archived, and when. */
const organizationTeamRestArchivedSchemaDefinition = z.object({
  id: z.string().min(1),
  name: z.string().min(1),
  archivedAt: z.date().nullable(),
});
export interface OrganizationTeamRestArchivedSchema extends Named<
  typeof organizationTeamRestArchivedSchemaDefinition
> {}
export const organizationTeamRestArchivedSchema: OrganizationTeamRestArchivedSchema =
  organizationTeamRestArchivedSchemaDefinition;

/** One team member, with the role their binding grants at the team. */
const organizationTeamRestMemberSchemaDefinition = z.object({
  userId: z.string().min(1),
  name: z.string().nullable(),
  email: z.string().nullable(),
  role: organizationTeamMemberRoleSchema,
});
export interface OrganizationTeamRestMemberSchema extends Named<
  typeof organizationTeamRestMemberSchemaDefinition
> {}
export const organizationTeamRestMemberSchema: OrganizationTeamRestMemberSchema =
  organizationTeamRestMemberSchemaDefinition;

const organizationTeamRestMemberListSchemaDefinition = z.object({
  data: z.array(organizationTeamRestMemberSchema),
});
export interface OrganizationTeamRestMemberListSchema extends Named<
  typeof organizationTeamRestMemberListSchemaDefinition
> {}
export const organizationTeamRestMemberListSchema: OrganizationTeamRestMemberListSchema =
  organizationTeamRestMemberListSchemaDefinition;

/** Page and page size a collection route reads off the query string. */
const organizationTeamRestPaginationQuerySchemaDefinition = z.object({
  page: z.coerce.number().int().positive().optional().default(1),
  limit: z.coerce.number().int().positive().max(1000).optional().default(50),
});
export interface OrganizationTeamRestPaginationQuerySchema extends Named<
  typeof organizationTeamRestPaginationQuerySchemaDefinition
> {}
export const organizationTeamRestPaginationQuerySchema: OrganizationTeamRestPaginationQuerySchema =
  organizationTeamRestPaginationQuerySchemaDefinition;

/** Postgres cannot store U+0000, so a name carrying one is the caller's error, not a 500. */
const withoutNullByte = (value: string) => !value.includes("\u0000");

/** The body a create takes: a name, and nothing else. */
const organizationTeamRestCreateSchemaDefinition = z.object({
  name: z
    .string()
    .min(1, "name is required")
    .max(255)
    .refine(withoutNullByte, "name must not contain a null byte"),
});
export interface OrganizationTeamRestCreateSchema extends Named<
  typeof organizationTeamRestCreateSchemaDefinition
> {}
export const organizationTeamRestCreateSchema: OrganizationTeamRestCreateSchema =
  organizationTeamRestCreateSchemaDefinition;

/** The body a rename takes. A PATCH here never touches membership. */
const organizationTeamRestUpdateSchemaDefinition = z.object({
  name: z
    .string()
    .min(1)
    .max(255)
    .refine(withoutNullByte, "name must not contain a null byte")
    .optional(),
});
export interface OrganizationTeamRestUpdateSchema extends Named<
  typeof organizationTeamRestUpdateSchemaDefinition
> {}
export const organizationTeamRestUpdateSchema: OrganizationTeamRestUpdateSchema =
  organizationTeamRestUpdateSchemaDefinition;

/** The body that adds one member to a team, at a role. */
const organizationTeamRestAddMemberSchemaDefinition = z.object({
  userId: z.string().min(1, "userId is required"),
  role: organizationTeamRoleSchema.optional().default("MEMBER"),
});
export interface OrganizationTeamRestAddMemberSchema extends Named<
  typeof organizationTeamRestAddMemberSchemaDefinition
> {}
export const organizationTeamRestAddMemberSchema: OrganizationTeamRestAddMemberSchema =
  organizationTeamRestAddMemberSchemaDefinition;

/** The path a route addressing one team carries. */
const organizationTeamRestParamsSchemaDefinition = z.object({ teamId: z.string().min(1) });
export interface OrganizationTeamRestParamsSchema extends Named<
  typeof organizationTeamRestParamsSchemaDefinition
> {}
export const organizationTeamRestParamsSchema: OrganizationTeamRestParamsSchema =
  organizationTeamRestParamsSchemaDefinition;

/** The path a route addressing one member of one team carries. */
const organizationTeamRestMemberParamsSchemaDefinition = z.object({
  ...organizationTeamRestParamsSchema.shape,
  userId: z.string().min(1),
});
export interface OrganizationTeamRestMemberParamsSchema extends Named<
  typeof organizationTeamRestMemberParamsSchemaDefinition
> {}
export const organizationTeamRestMemberParamsSchema: OrganizationTeamRestMemberParamsSchema =
  organizationTeamRestMemberParamsSchemaDefinition;

/** What a route answers when the whole of its answer is that it worked. */
const organizationTeamRestSuccessSchemaDefinition = z.object({ success: z.boolean() });
export interface OrganizationTeamRestSuccessSchema extends Named<
  typeof organizationTeamRestSuccessSchemaDefinition
> {}
export const organizationTeamRestSuccessSchema: OrganizationTeamRestSuccessSchema =
  organizationTeamRestSuccessSchemaDefinition;

/** One project of a team: its name and stamps, never its keys. */
const organizationTeamRestProjectSchema = z.object({
  id: z.string().min(1),
  name: z.string(),
  slug: z.string(),
  createdAt: z.date(),
  updatedAt: z.date(),
});

/** The projects of one team, as the door lists them. */
const organizationTeamRestProjectListSchemaDefinition = z.object({
  data: z.array(organizationTeamRestProjectSchema),
});
export interface OrganizationTeamRestProjectListSchema extends Named<
  typeof organizationTeamRestProjectListSchemaDefinition
> {}
export const organizationTeamRestProjectListSchema: OrganizationTeamRestProjectListSchema =
  organizationTeamRestProjectListSchemaDefinition;
