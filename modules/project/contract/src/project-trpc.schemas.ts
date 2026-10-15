import type { Named } from "@langwatch/module";
/**
 * What the project's three tRPC namespaces accept, stated once. These parsers
 * are the wire contract the browser has always sent: same fields, same
 * defaults, same refusals.
 */
import { z } from "zod";

import { aggregateRuleSchema } from "./project.aggregate-rule.ts";
import { PROJECT_KIND } from "./project.ts";

/** The project a procedure acts on, and the only field most of them take. */
const projectScopeSchemaDefinition = z.object({ projectId: z.string() });
export interface ProjectScopeSchema extends Named<typeof projectScopeSchemaDefinition> {}
export const projectScopeSchema: ProjectScopeSchema = projectScopeSchemaDefinition;
export type ProjectScopeInput = z.infer<typeof projectScopeSchema>;

/**
 * A project is provisioned into an existing team, or into a team created
 * alongside it. Which of the two is asked for decides the scope the caller's
 * standing is resolved at, so both fields stay optional here.
 */
const projectCreateInputSchemaDefinition = z.object({
  organizationId: z.string(),
  teamId: z.string().optional(),
  newTeamName: z.string().optional(),
  name: z.string(),
  language: z.string(),
  framework: z.string(),
  /** ADR-177: an aggregate reads its members and owns no traces. */
  kind: z.enum([PROJECT_KIND.APPLICATION, PROJECT_KIND.AGGREGATE]).optional(),
  aggregateRule: aggregateRuleSchema.optional(),
});
export interface ProjectCreateInputSchema extends Named<
  typeof projectCreateInputSchemaDefinition
> {}
export const projectCreateInputSchema: ProjectCreateInputSchema =
  projectCreateInputSchemaDefinition;
export type ProjectCreateInput = z.infer<typeof projectCreateInputSchema>;

/**
 * The settings form. The stored-object credentials are all-or-nothing: a
 * half-filled set would persist an endpoint the project cannot actually reach.
 */
const projectUpdateInputSchemaDefinition = z
  .object({
    projectId: z.string(),
    name: z.string().optional(),
    language: z.string().optional(),
    framework: z.string().optional(),
    teamId: z.string().optional(),
    traceSharingEnabled: z.boolean().optional(),
    /** Read only when sharing is switched off; absent means revoke. */
    revokeExistingLinks: z.boolean().optional(),
    presenceEnabled: z.boolean().optional(),
    userLinkTemplate: z.string().optional(),
    s3Endpoint: z.string().optional(),
    s3AccessKeyId: z.string().optional(),
    s3SecretAccessKey: z.string().optional(),
    s3Bucket: z.string().optional(),
  })
  .refine((data) => {
    const hasEndpoint = !!data.s3Endpoint?.trim();
    const hasAccessKey = !!data.s3AccessKeyId?.trim();
    const hasSecretKey = !!data.s3SecretAccessKey?.trim();

    return (hasEndpoint && hasAccessKey) || (!hasEndpoint && !hasAccessKey && !hasSecretKey);
  });
export interface ProjectUpdateInputSchema extends Named<
  typeof projectUpdateInputSchemaDefinition
> {}
export const projectUpdateInputSchema: ProjectUpdateInputSchema =
  projectUpdateInputSchemaDefinition;
export type ProjectUpdateInput = z.infer<typeof projectUpdateInputSchema>;

/** Two projects: the one the caller is in, and the one being archived. */
const projectArchiveByIdInputSchemaDefinition = z.object({
  projectId: z.string(),
  projectToArchiveId: z.string(),
});
export interface ProjectArchiveByIdInputSchema extends Named<
  typeof projectArchiveByIdInputSchemaDefinition
> {}
export const projectArchiveByIdInputSchema: ProjectArchiveByIdInputSchema =
  projectArchiveByIdInputSchemaDefinition;
export type ProjectArchiveByIdInput = z.infer<typeof projectArchiveByIdInputSchema>;

/** An organisation admin replaces which projects an aggregate reads. */
const projectUpdateAggregateRuleInputSchemaDefinition = z.object({
  projectId: z.string(),
  aggregateRule: aggregateRuleSchema,
});
export interface ProjectUpdateAggregateRuleInputSchema extends Named<
  typeof projectUpdateAggregateRuleInputSchemaDefinition
> {}
export const projectUpdateAggregateRuleInputSchema: ProjectUpdateAggregateRuleInputSchema =
  projectUpdateAggregateRuleInputSchemaDefinition;
export type ProjectUpdateAggregateRuleInput = z.infer<typeof projectUpdateAggregateRuleInputSchema>;

/** The organisation whose projects an aggregate's explicit rule may name. */
const projectAggregateMemberCandidatesInputSchemaDefinition = z.object({
  organizationId: z.string(),
});
export interface ProjectAggregateMemberCandidatesInputSchema extends Named<
  typeof projectAggregateMemberCandidatesInputSchemaDefinition
> {}
export const projectAggregateMemberCandidatesInputSchema: ProjectAggregateMemberCandidatesInputSchema =
  projectAggregateMemberCandidatesInputSchemaDefinition;
