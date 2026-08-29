import { z } from "zod";

export const PROJECT_FEATURE_ID = "project" as const;

export const PROJECT_KIND = {
  APPLICATION: "application",
  INTERNAL_GOVERNANCE: "internal_governance",
} as const;

export const projectKindSchema = z.enum(PROJECT_KIND);
export type ProjectKind = z.infer<typeof projectKindSchema>;

export const internalProjectKindSchema = z.literal(PROJECT_KIND.INTERNAL_GOVERNANCE);
export type InternalProjectKind = z.infer<typeof internalProjectKindSchema>;

export const internalProjectSchema = z
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
export type InternalProject = z.infer<typeof internalProjectSchema>;

export const internalProjectQuerySchema = z
  .object({
    organizationId: z.string().min(1),
    kind: internalProjectKindSchema,
  })
  .strict();
export type InternalProjectQuery = z.infer<typeof internalProjectQuerySchema>;

export const projectPresenceInputSchema = z
  .object({ projectId: z.string().min(1) })
  .strict();
export type ProjectPresenceInput = z.infer<typeof projectPresenceInputSchema>;

export const projectJsonValueSchema = z.json();
export type ProjectJsonValue = z.infer<typeof projectJsonValueSchema>;

/**
 * The scalar project value shared by the application transports.
 *
 * This deliberately mirrors the durable value without importing Prisma.  A
 * repository adapter owns the database mapping; callers of the feature see a
 * stable, serialisable value instead of a generated client type.
 */
export const projectSchema = z
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
    langyEgressAllowlist: projectJsonValueSchema.nullable(),
    lastCodingAgentSessionAt: z.date().nullable(),
    lastCodingAgentPullRequestAt: z.date().nullable(),
  })
  .strict();
export type Project = z.infer<typeof projectSchema>;

export const teamSchema = z
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
export type Team = z.infer<typeof teamSchema>;

export const projectWithTeamSchema = projectSchema.extend({ team: teamSchema });
export type ProjectWithTeam = z.infer<typeof projectWithTeamSchema>;

export const updateProjectInputSchema = z
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
export type UpdateProjectInput = z.infer<typeof updateProjectInputSchema>;

export const createProjectInputSchema = z
  .object({
    id: z.string().min(1),
    name: z.string(),
    slug: z.string().min(1),
    language: z.string(),
    framework: z.string(),
    teamId: z.string().min(1),
    apiKey: z.string(),
  })
  .strict();
export type CreateProjectInput = z.infer<typeof createProjectInputSchema>;

export const projectPaginationSchema = z
  .object({
    organizationId: z.string().min(1),
    page: z.number().int().positive(),
    limit: z.number().int().positive(),
    projectIds: z.array(z.string().min(1)).optional(),
  })
  .strict();
export type ProjectPaginationInput = z.infer<typeof projectPaginationSchema>;

export interface PaginatedProjects {
  data: Project[];
  pagination: { page: number; limit: number; total: number };
}

export const activeProjectsByScopesInputSchema = z
  .object({
    organizationId: z.string().min(1),
    organizationWide: z.boolean(),
    teamIds: z.array(z.string().min(1)),
    projectIds: z.array(z.string().min(1)),
    limit: z.number().int().positive(),
  })
  .strict();
export type ActiveProjectsByScopesInput = z.infer<
  typeof activeProjectsByScopesInputSchema
>;

export interface ActiveProjectsByScopes {
  data: Project[];
  hasMore: boolean;
}

export interface SearchProjectsResult {
  id: string;
  name: string;
  slug: string;
}

/**
 * Who a project is, and nothing about how it is configured.
 *
 * This is the value a request boundary carries. Authenticating a credential
 * has to name the project it belongs to, and the transport has to answer
 * "which tenant, which team, which organization" — five indexed columns.
 * Carrying the whole project there instead would read two full rows and
 * validate thirty fields on every authenticated request, to serve handlers
 * that overwhelmingly want an id. A handler that needs configuration asks
 * {@link ProjectService} for it, which is the read it would have made anyway.
 */
export const projectIdentitySchema = z
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
  })
  .strict();
export type ProjectIdentity = z.infer<typeof projectIdentitySchema>;

export const projectNamesByIdsInputSchema = z
  .object({ projectIds: z.array(z.string().min(1)) })
  .strict();
export type ProjectNamesByIdsInput = z.infer<typeof projectNamesByIdsInputSchema>;

export const projectIdsByOrganizationInputSchema = z
  .object({ organizationId: z.string().min(1) })
  .strict();
export type ProjectIdsByOrganizationInput = z.infer<
  typeof projectIdsByOrganizationInputSchema
>;

export interface TraceSharingConfig {
  orgEnabled: boolean;
  projectEnabled: boolean;
}

/** Internal Gateway-only trace export credential, never a transport DTO. */
export const traceDestinationProjectSchema = z
  .object({
    id: z.string().min(1),
    teamId: z.string().min(1),
    apiKey: z.string(),
    archivedAt: z.date().nullable(),
  })
  .strict();
export type TraceDestinationProject = z.infer<typeof traceDestinationProjectSchema>;

export const traceDestinationProjectIdSchema = z.string().min(1);
export const traceDestinationProjectIdsSchema = z.array(traceDestinationProjectIdSchema);

export const traceDestinationInputSchema = z
  .object({
    organizationId: z.string().min(1),
    projectScopeIds: z.array(z.string().min(1)),
    traceProjectId: z.string().min(1).nullable().optional(),
  })
  .strict();
export type TraceDestinationInput = z.infer<typeof traceDestinationInputSchema>;

export const traceDestinationDecisionSchema = z.discriminatedUnion("outcome", [
  z
    .object({ outcome: z.literal("resolved"), project: traceDestinationProjectSchema })
    .strict(),
  z.object({ outcome: z.literal("unknown") }).strict(),
  z
    .object({
      outcome: z.literal("ambiguous"),
      projectScopeCount: z.number().int().nonnegative(),
    })
    .strict(),
  z.object({ outcome: z.literal("no_destination") }).strict(),
]);
export type TraceDestinationDecision = z.infer<typeof traceDestinationDecisionSchema>;

export interface OrgAdminResolution {
  userId: string | null;
  organizationId: string | null;
  firstMessage: boolean;
}

export interface UpdateProjectMetadataInput {
  id: string;
  data: { firstMessage: boolean; integrated: boolean; language: string };
}
