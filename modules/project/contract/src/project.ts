import { dataPrivacyPiiRedactionLevelSchema } from "@langwatch/data-privacy-contract";
import type { Named } from "@langwatch/module";
import type { OnboardingVariant } from "@langwatch/onboarding-contract";
import type { Instant } from "@langwatch/time";
import { z } from "zod";

import { aggregateRuleSchema } from "./project.aggregate-rule.ts";

export const PROJECT_FEATURE_ID = "project" as const;

export const PROJECT_KIND = {
  APPLICATION: "application",
  INTERNAL_GOVERNANCE: "internal_governance",
  AGGREGATE: "aggregate",
} as const;

export const projectKindSchema = z.enum(PROJECT_KIND);
export type ProjectKind = z.infer<typeof projectKindSchema>;

export const internalProjectKindSchema = z.literal(PROJECT_KIND.INTERNAL_GOVERNANCE);
export type InternalProjectKind = z.infer<typeof internalProjectKindSchema>;

const internalProjectSchemaDefinition = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    slug: z.string().min(1),
    teamId: z.string().min(1),
    kind: internalProjectKindSchema,
    archivedAtMs: z.number().int().nonnegative().nullable(),
    traceSharingEnabled: z.literal(false),
  })
  .strict();
export interface InternalProjectSchema extends Named<typeof internalProjectSchemaDefinition> {}
export const internalProjectSchema: InternalProjectSchema = internalProjectSchemaDefinition;
export type InternalProject = z.infer<typeof internalProjectSchema>;

const internalProjectQuerySchemaDefinition = z
  .object({
    organizationId: z.string().min(1),
    kind: internalProjectKindSchema,
  })
  .strict();
export interface InternalProjectQuerySchema extends Named<
  typeof internalProjectQuerySchemaDefinition
> {}
export const internalProjectQuerySchema: InternalProjectQuerySchema =
  internalProjectQuerySchemaDefinition;
export type InternalProjectQuery = z.infer<typeof internalProjectQuerySchema>;

const projectPresenceInputSchemaDefinition = z.object({ projectId: z.string().min(1) }).strict();
export interface ProjectPresenceInputSchema extends Named<
  typeof projectPresenceInputSchemaDefinition
> {}
export const projectPresenceInputSchema: ProjectPresenceInputSchema =
  projectPresenceInputSchemaDefinition;
export type ProjectPresenceInput = z.infer<typeof projectPresenceInputSchema>;

export const projectJsonValueSchema = z.json();
export type ProjectJsonValue = z.infer<typeof projectJsonValueSchema>;

/**
 * The scalar project value shared by the application transports. Mirrors the
 * durable value without importing Prisma — a repository adapter owns the
 * database mapping, so callers see a stable value, not a generated client type.
 */
const projectSchemaDefinition = z
  .object({
    id: z.string().min(1),
    name: z.string(),
    slug: z.string().min(1),
    apiKey: z.string(),
    lwqlKey: z.string(),
    teamId: z.string().min(1),
    language: z.string(),
    framework: z.string(),
    kind: z.string().min(1),
    firstMessage: z.boolean(),
    integrated: z.boolean(),
    createdAt: z.date(),
    updatedAt: z.date(),
    userLinkTemplate: z.string().nullable(),
    traceSharingEnabled: z.boolean(),
    presenceEnabled: z.boolean(),
    s3Endpoint: z.string().nullable(),
    s3AccessKeyId: z.string().nullable(),
    s3SecretAccessKey: z.string().nullable(),
    s3Bucket: z.string().nullable(),
    archivedAt: z.date().nullable(),
    isPersonal: z.boolean(),
    ownerUserId: z.string().nullable(),
    personalFeatures: projectJsonValueSchema,
    departmentId: z.string().nullable(),
    /** ADR-177: an aggregate's stored rule; optional so fixtures predating it still parse. */
    aggregateRule: projectJsonValueSchema.nullable().optional(),
    langyEgressAllowlist: projectJsonValueSchema.nullable(),
    lastCodingAgentSessionAt: z.date().nullable(),
    lastCodingAgentPullRequestAt: z.date().nullable(),
  })
  .strict();
export interface ProjectSchema extends Named<typeof projectSchemaDefinition> {}
export const projectSchema: ProjectSchema = projectSchemaDefinition;
export type Project = z.infer<typeof projectSchema>;

/** A project the archive just stamped: its archive time is always set. */
export type ArchivedProject = Omit<Project, "archivedAt"> & {
  archivedAt: NonNullable<Project["archivedAt"]>;
};

const teamSchemaDefinition = z
  .object({
    id: z.string().min(1),
    name: z.string(),
    slug: z.string().min(1),
    organizationId: z.string().min(1),
    createdAt: z.date(),
    updatedAt: z.date(),
    archivedAt: z.date().nullable(),
    isPersonal: z.boolean(),
    ownerUserId: z.string().nullable(),
    departmentId: z.string().nullable(),
  })
  .strict();
export interface TeamSchema extends Named<typeof teamSchemaDefinition> {}
export const teamSchema: TeamSchema = teamSchemaDefinition;
export type Team = z.infer<typeof teamSchema>;

const projectWithTeamSchemaDefinition = projectSchema.safeExtend({ team: teamSchema });
export interface ProjectWithTeamSchema extends Named<typeof projectWithTeamSchemaDefinition> {}
export const projectWithTeamSchema: ProjectWithTeamSchema = projectWithTeamSchemaDefinition;
export type ProjectWithTeam = z.infer<typeof projectWithTeamSchema>;

const updateProjectInputSchemaDefinition = z
  .object({
    name: z.string().optional(),
    language: z.string().optional(),
    framework: z.string().optional(),
    teamId: z.string().optional(),
    apiKey: z.string().optional(),
    traceSharingEnabled: z.boolean().optional(),
    presenceEnabled: z.boolean().optional(),
    userLinkTemplate: z.string().nullable().optional(),
    s3Endpoint: z.string().nullable().optional(),
    s3AccessKeyId: z.string().nullable().optional(),
    s3SecretAccessKey: z.string().nullable().optional(),
    s3Bucket: z.string().nullable().optional(),
  })
  .strict();
export interface UpdateProjectInputSchema extends Named<
  typeof updateProjectInputSchemaDefinition
> {}
export const updateProjectInputSchema: UpdateProjectInputSchema =
  updateProjectInputSchemaDefinition;
export type UpdateProjectInput = z.infer<typeof updateProjectInputSchema>;

const setTraceSharingInputSchemaDefinition = z
  .object({
    projectId: z.string().min(1),
    enabled: z.boolean(),
    /** Only read when switching off: false keeps the links paused until sharing returns. */
    revokeExistingLinks: z.boolean(),
    by: z.object({ id: z.string().min(1) }),
  })
  .strict();
export interface SetTraceSharingInputSchema extends Named<
  typeof setTraceSharingInputSchemaDefinition
> {}
export const setTraceSharingInputSchema: SetTraceSharingInputSchema =
  setTraceSharingInputSchemaDefinition;
export type SetTraceSharingInput = z.infer<typeof setTraceSharingInputSchema>;

const createProjectInputSchemaDefinition = z
  .object({
    id: z.string().min(1),
    name: z.string(),
    slug: z.string().min(1),
    language: z.string(),
    framework: z.string(),
    teamId: z.string().min(1),
    apiKey: z.string(),
    /** Omitted means the column default, `"application"`. */
    kind: projectKindSchema.optional(),
    /** ADR-177: set only on an aggregate project, already validated. */
    aggregateRule: aggregateRuleSchema.optional(),
  })
  .strict();
export interface CreateProjectInputSchema extends Named<
  typeof createProjectInputSchemaDefinition
> {}
export const createProjectInputSchema: CreateProjectInputSchema =
  createProjectInputSchemaDefinition;
export type CreateProjectInput = z.infer<typeof createProjectInputSchema>;

const projectPaginationSchemaDefinition = z
  .object({
    organizationId: z.string().min(1),
    page: z.number().int().positive(),
    limit: z.number().int().positive(),
    projectIds: z.array(z.string().min(1)).optional(),
    includeGovernance: z.boolean().optional(),
    hiddenKinds: z.array(projectKindSchema).optional(),
  })
  .strict();
export interface ProjectPaginationSchema extends Named<typeof projectPaginationSchemaDefinition> {}
export const projectPaginationSchema: ProjectPaginationSchema = projectPaginationSchemaDefinition;
export type ProjectPaginationInput = z.infer<typeof projectPaginationSchema>;

export interface PaginatedProjects {
  data: Project[];
  pagination: { page: number; limit: number; total: number };
}

const activeProjectsByScopesInputSchemaDefinition = z
  .object({
    organizationId: z.string().min(1),
    organizationWide: z.boolean(),
    teamIds: z.array(z.string().min(1)),
    projectIds: z.array(z.string().min(1)),
    limit: z.number().int().positive(),
  })
  .strict();
export interface ActiveProjectsByScopesInputSchema extends Named<
  typeof activeProjectsByScopesInputSchemaDefinition
> {}
export const activeProjectsByScopesInputSchema: ActiveProjectsByScopesInputSchema =
  activeProjectsByScopesInputSchemaDefinition;
export type ActiveProjectsByScopesInput = z.infer<typeof activeProjectsByScopesInputSchema>;

export interface ActiveProjectsByScopes {
  data: Project[];
  hasMore: boolean;
}

const searchProjectsResultSchemaDefinition = z.object({
  id: z.string(),
  name: z.string(),
  slug: z.string(),
});
export interface SearchProjectsResultSchema extends Named<
  typeof searchProjectsResultSchemaDefinition
> {}
export const searchProjectsResultSchema: SearchProjectsResultSchema =
  searchProjectsResultSchemaDefinition;
export type SearchProjectsResult = z.infer<typeof searchProjectsResultSchema>;

/**
 * Project identity for request boundaries: id, name, tenant/team/org; handlers
 * needing config ask ProjectService.
 */
const projectIdentitySchemaDefinition = z
  .object({
    id: z.string().min(1),
    name: z.string().min(1),
    slug: z.string().min(1),
    teamId: z.string().min(1),
    organizationId: z.string().min(1),
    /** Whether the workspace belongs to exactly one person. */
    isPersonal: z.boolean(),
    /** That person, when the workspace is personal. */
    ownerUserId: z.string().min(1).nullable(),
    /** ADR-177: the door refuses every credential presented for an aggregate. */
    kind: z.string().min(1),
  })
  .strict();
export interface ProjectIdentitySchema extends Named<typeof projectIdentitySchemaDefinition> {}
export const projectIdentitySchema: ProjectIdentitySchema = projectIdentitySchemaDefinition;
export type ProjectIdentity = z.infer<typeof projectIdentitySchema>;

const projectNamesByIdsInputSchemaDefinition = z
  .object({ projectIds: z.array(z.string().min(1)) })
  .strict();
export interface ProjectNamesByIdsInputSchema extends Named<
  typeof projectNamesByIdsInputSchemaDefinition
> {}
export const projectNamesByIdsInputSchema: ProjectNamesByIdsInputSchema =
  projectNamesByIdsInputSchemaDefinition;
export type ProjectNamesByIdsInput = z.infer<typeof projectNamesByIdsInputSchema>;

const projectIdsByOrganizationInputSchemaDefinition = z
  .object({ organizationId: z.string().min(1) })
  .strict();
export interface ProjectIdsByOrganizationInputSchema extends Named<
  typeof projectIdsByOrganizationInputSchemaDefinition
> {}
export const projectIdsByOrganizationInputSchema: ProjectIdsByOrganizationInputSchema =
  projectIdsByOrganizationInputSchemaDefinition;
export type ProjectIdsByOrganizationInput = z.infer<typeof projectIdsByOrganizationInputSchema>;

const liveProjectIdsByOrganizationInputSchemaDefinition =
  projectIdsByOrganizationInputSchema.safeExtend({ includeArchived: z.boolean().default(false) });
export interface LiveProjectIdsByOrganizationInputSchema extends Named<
  typeof liveProjectIdsByOrganizationInputSchemaDefinition
> {}
export const liveProjectIdsByOrganizationInputSchema: LiveProjectIdsByOrganizationInputSchema =
  liveProjectIdsByOrganizationInputSchemaDefinition;
export type LiveProjectIdsByOrganizationInput = z.input<
  typeof liveProjectIdsByOrganizationInputSchema
>;

export interface TraceSharingConfig {
  orgEnabled: boolean;
  projectEnabled: boolean;
}

/** The project a gateway's spans land in; its export key is the gateway's own, never this. */
const traceDestinationProjectSchemaDefinition = z
  .object({
    id: z.string().min(1),
    teamId: z.string().min(1),
    archivedAt: z.date().nullable(),
    kind: z.string(),
  })
  .strict();
export interface TraceDestinationProjectSchema extends Named<
  typeof traceDestinationProjectSchemaDefinition
> {}
export const traceDestinationProjectSchema: TraceDestinationProjectSchema =
  traceDestinationProjectSchemaDefinition;
export type TraceDestinationProject = z.infer<typeof traceDestinationProjectSchema>;

export const traceDestinationProjectIdSchema = z.string().min(1);
const traceDestinationProjectIdsSchemaDefinition = z.array(traceDestinationProjectIdSchema);
export interface TraceDestinationProjectIdsSchema extends Named<
  typeof traceDestinationProjectIdsSchemaDefinition
> {}
export const traceDestinationProjectIdsSchema: TraceDestinationProjectIdsSchema =
  traceDestinationProjectIdsSchemaDefinition;

const traceDestinationInputSchemaDefinition = z
  .object({
    organizationId: z.string().min(1),
    projectScopeIds: z.array(z.string().min(1)),
    traceProjectId: z.string().min(1).nullable().optional(),
  })
  .strict();
export interface TraceDestinationInputSchema extends Named<
  typeof traceDestinationInputSchemaDefinition
> {}
export const traceDestinationInputSchema: TraceDestinationInputSchema =
  traceDestinationInputSchemaDefinition;
export type TraceDestinationInput = z.infer<typeof traceDestinationInputSchema>;

const traceDestinationDecisionSchemaDefinition = z.discriminatedUnion("outcome", [
  z.object({ outcome: z.literal("resolved"), project: traceDestinationProjectSchema }).strict(),
  z.object({ outcome: z.literal("unknown") }).strict(),
  z
    .object({
      outcome: z.literal("ambiguous"),
      projectScopeCount: z.number().int().nonnegative(),
    })
    .strict(),
  z.object({ outcome: z.literal("no_destination") }).strict(),
]);
export interface TraceDestinationDecisionSchema extends Named<
  typeof traceDestinationDecisionSchemaDefinition
> {}
export const traceDestinationDecisionSchema: TraceDestinationDecisionSchema =
  traceDestinationDecisionSchemaDefinition;
export type TraceDestinationDecision = z.infer<typeof traceDestinationDecisionSchema>;

export interface OrgAdminResolution {
  userId: string | null;
  organizationId: string | null;
  firstMessage: boolean;
  /** Which onboarding the organization went through; null before the experiment. */
  onboardingVariant: OnboardingVariant | null;
  /** When the organization was created, for milestones measured in days since signup. */
  organizationCreatedAt: Instant | null;
}

export interface UpdateProjectMetadataInput {
  id: string;
  data: { firstMessage: boolean; integrated: boolean; language: string };
}

const projectRestUpdateSchemaDefinition = z.object({
  name: z.string().min(1).max(255).optional(),
  language: z.string().optional(),
  framework: z.string().optional(),
  teamId: z.string().min(1).optional().describe("Moves the project to this team"),
  piiRedactionLevel: dataPrivacyPiiRedactionLevelSchema
    .optional()
    .describe("The PII level the project's traces are redacted at"),
});
export interface ProjectRestUpdateSchema extends Named<typeof projectRestUpdateSchemaDefinition> {}
export const projectRestUpdateSchema: ProjectRestUpdateSchema = projectRestUpdateSchemaDefinition;

const projectRestParamsSchemaDefinition = z.object({ id: z.string().min(1) });
export interface ProjectRestParamsSchema extends Named<typeof projectRestParamsSchemaDefinition> {}
export const projectRestParamsSchema: ProjectRestParamsSchema = projectRestParamsSchemaDefinition;

/** Regenerating the key takes no body; an absent one is read as this. */
const projectRestRegenerateApiKeyInputSchemaDefinition = z.object({});
export interface ProjectRestRegenerateApiKeyInputSchema extends Named<
  typeof projectRestRegenerateApiKeyInputSchemaDefinition
> {}
export const projectRestRegenerateApiKeyInputSchema: ProjectRestRegenerateApiKeyInputSchema =
  projectRestRegenerateApiKeyInputSchemaDefinition;
