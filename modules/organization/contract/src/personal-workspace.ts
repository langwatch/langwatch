import { HandledError, NotFoundError } from "@langwatch/handled-error";
import type { Named } from "@langwatch/module";
import { z } from "zod";

const personalWorkspaceInputSchemaDefinition = z
  .object({
    userId: z.string().min(1),
    organizationId: z.string().min(1),
    displayName: z.string().nullable().optional(),
    displayEmail: z.string().nullable().optional(),
  })
  .strict();
export interface PersonalWorkspaceInputSchema extends Named<
  typeof personalWorkspaceInputSchemaDefinition
> {}
export const personalWorkspaceInputSchema: PersonalWorkspaceInputSchema =
  personalWorkspaceInputSchemaDefinition;
export type PersonalWorkspaceInput = z.infer<typeof personalWorkspaceInputSchema>;

const findPersonalWorkspaceInputSchemaDefinition = z
  .object({
    userId: z.string().min(1),
    organizationId: z.string().min(1),
  })
  .strict();
export interface FindPersonalWorkspaceInputSchema extends Named<
  typeof findPersonalWorkspaceInputSchemaDefinition
> {}
export const findPersonalWorkspaceInputSchema: FindPersonalWorkspaceInputSchema =
  findPersonalWorkspaceInputSchemaDefinition;
export type FindPersonalWorkspaceInput = z.infer<typeof findPersonalWorkspaceInputSchema>;

const personalWorkspaceSchemaDefinition = z
  .object({
    team: z
      .object({
        id: z.string().min(1),
        name: z.string().min(1),
        slug: z.string().min(1),
        createdAtMs: z.number().int().nonnegative(),
      })
      .strict(),
    project: z
      .object({
        id: z.string().min(1),
        name: z.string().min(1),
        slug: z.string().min(1),
        apiKey: z.string().min(1),
        createdAtMs: z.number().int().nonnegative(),
      })
      .strict(),
  })
  .strict();
export interface PersonalWorkspaceSchema extends Named<typeof personalWorkspaceSchemaDefinition> {}
export const personalWorkspaceSchema: PersonalWorkspaceSchema = personalWorkspaceSchemaDefinition;
export type PersonalWorkspace = z.infer<typeof personalWorkspaceSchema>;

/** Pending until project has created the personal project; wait on `lw.project.created` for it. */
const ensuredPersonalWorkspaceSchemaDefinition = z.discriminatedUnion("kind", [
  z.object({ kind: z.literal("ready"), workspace: personalWorkspaceSchema }).strict(),
  z
    .object({
      kind: z.literal("pending"),
      team: personalWorkspaceSchema.shape.team,
    })
    .strict(),
]);
export interface EnsuredPersonalWorkspaceSchema extends Named<
  typeof ensuredPersonalWorkspaceSchemaDefinition
> {}
export const ensuredPersonalWorkspaceSchema: EnsuredPersonalWorkspaceSchema =
  ensuredPersonalWorkspaceSchemaDefinition;
export type EnsuredPersonalWorkspace = z.infer<typeof ensuredPersonalWorkspaceSchema>;

/** A mutation that needs the personal project refuses while project is still creating it. */
export class PersonalWorkspacePendingError extends HandledError {
  declare readonly code: "personal_workspace_pending";

  constructor() {
    super("personal_workspace_pending", "The personal workspace is still being created", {
      httpStatus: 409,
      retryable: true,
    });
    this.name = "PersonalWorkspacePendingError";
  }
}

export const PERSONAL_FEATURES = ["evaluations", "datasets", "annotations", "automations"] as const;
export const personalFeatureSchema = z.enum(PERSONAL_FEATURES);
export type PersonalFeature = z.infer<typeof personalFeatureSchema>;

const personalFeaturesSchemaDefinition = z
  .object({
    evaluations: z.boolean(),
    datasets: z.boolean(),
    annotations: z.boolean(),
    automations: z.boolean(),
  })
  .strict();
export interface PersonalFeaturesSchema extends Named<typeof personalFeaturesSchemaDefinition> {}
export const personalFeaturesSchema: PersonalFeaturesSchema = personalFeaturesSchemaDefinition;
export type PersonalFeatures = z.infer<typeof personalFeaturesSchema>;

const personalWorkspaceFeaturesInputSchemaDefinition = z
  .object({
    projectId: z.string().min(1),
    callerUserId: z.string().min(1),
  })
  .strict();
export interface PersonalWorkspaceFeaturesInputSchema extends Named<
  typeof personalWorkspaceFeaturesInputSchemaDefinition
> {}
export const personalWorkspaceFeaturesInputSchema: PersonalWorkspaceFeaturesInputSchema =
  personalWorkspaceFeaturesInputSchemaDefinition;
export type PersonalWorkspaceFeaturesInput = z.infer<typeof personalWorkspaceFeaturesInputSchema>;

export function personalFeatureEnabled(stored: unknown, feature: PersonalFeature): boolean {
  return Boolean(
    stored && typeof stored === "object" && (stored as Record<string, unknown>)[feature] === true,
  );
}

export function readPersonalFeatures(stored: unknown): PersonalFeatures {
  return {
    evaluations: personalFeatureEnabled(stored, "evaluations"),
    datasets: personalFeatureEnabled(stored, "datasets"),
    annotations: personalFeatureEnabled(stored, "annotations"),
    automations: personalFeatureEnabled(stored, "automations"),
  };
}

export class PersonalProjectNotFoundError extends NotFoundError {
  declare readonly code: "personal_project_not_found";

  constructor(projectId: string) {
    super("personal_project_not_found", { resource: "Personal project", id: projectId });
    this.name = "PersonalProjectNotFoundError";
  }
}

/** Answers as not found, so a caller cannot probe other people's personal projects by id. */
export class PersonalProjectOwnerMismatchError extends NotFoundError {
  declare readonly code: "personal_project_owner_mismatch";

  constructor(projectId: string) {
    super("personal_project_owner_mismatch", { resource: "Personal project", id: projectId });
    this.name = "PersonalProjectOwnerMismatchError";
  }
}

/** Recorded before Round 54, when organization wrote the project; project still records them. */
export const PERSONAL_WORKSPACE_PROVISIONED_EVENT_TYPE =
  "lw.organization.personal_workspace_provisioned" as const;

/** Ids only: the tenant is the organization, and a peer reads the project through `ProjectApi`. */
const personalWorkspaceProvisionedEventDataSchemaDefinition = z.object({
  tenantId: z.string().min(1),
  organizationId: z.string().min(1),
  userId: z.string().min(1),
  projectId: z.string().min(1),
  occurredAt: z.number().int().nonnegative(),
});
export interface PersonalWorkspaceProvisionedEventDataSchema extends Named<
  typeof personalWorkspaceProvisionedEventDataSchemaDefinition
> {}
export const personalWorkspaceProvisionedEventDataSchema: PersonalWorkspaceProvisionedEventDataSchema =
  personalWorkspaceProvisionedEventDataSchemaDefinition;
export type PersonalWorkspaceProvisionedEventData = z.infer<
  typeof personalWorkspaceProvisionedEventDataSchema
>;

/**
 * A personal team was created; project creates its personal project under the named id and slug,
 * and mints its key, which never enters the event log (Round 54, O1-D1-KEY).
 */
export const PERSONAL_TEAM_CREATED_EVENT_TYPE = "lw.organization.personal_team_created" as const;

const personalTeamCreatedEventDataSchemaDefinition = z.object({
  tenantId: z.string().min(1),
  organizationId: z.string().min(1),
  userId: z.string().min(1),
  teamId: z.string().min(1),
  projectId: z.string().min(1),
  projectSlug: z.string().min(1),
  occurredAt: z.number().int().nonnegative(),
});
export interface PersonalTeamCreatedEventDataSchema extends Named<
  typeof personalTeamCreatedEventDataSchemaDefinition
> {}
export const personalTeamCreatedEventDataSchema: PersonalTeamCreatedEventDataSchema =
  personalTeamCreatedEventDataSchemaDefinition;
export type PersonalTeamCreatedEventData = z.infer<typeof personalTeamCreatedEventDataSchema>;

/** A removed member's personal teams were archived; project archives their personal projects. */
export const PERSONAL_WORKSPACE_ARCHIVED_EVENT_TYPE =
  "lw.organization.personal_workspace_archived" as const;

const personalWorkspaceArchivedEventDataSchemaDefinition = z.object({
  tenantId: z.string().min(1),
  organizationId: z.string().min(1),
  userId: z.string().min(1),
  teamIds: z.array(z.string().min(1)).min(1),
  occurredAt: z.number().int().nonnegative(),
});
export interface PersonalWorkspaceArchivedEventDataSchema extends Named<
  typeof personalWorkspaceArchivedEventDataSchemaDefinition
> {}
export const personalWorkspaceArchivedEventDataSchema: PersonalWorkspaceArchivedEventDataSchema =
  personalWorkspaceArchivedEventDataSchemaDefinition;
export type PersonalWorkspaceArchivedEventData = z.infer<
  typeof personalWorkspaceArchivedEventDataSchema
>;

/** A returning member's personal team was revived; project revives its personal project. */
export const PERSONAL_WORKSPACE_REVIVED_EVENT_TYPE =
  "lw.organization.personal_workspace_revived" as const;

const personalWorkspaceRevivedEventDataSchemaDefinition = z.object({
  tenantId: z.string().min(1),
  organizationId: z.string().min(1),
  userId: z.string().min(1),
  teamId: z.string().min(1),
  occurredAt: z.number().int().nonnegative(),
});
export interface PersonalWorkspaceRevivedEventDataSchema extends Named<
  typeof personalWorkspaceRevivedEventDataSchemaDefinition
> {}
export const personalWorkspaceRevivedEventDataSchema: PersonalWorkspaceRevivedEventDataSchema =
  personalWorkspaceRevivedEventDataSchemaDefinition;
export type PersonalWorkspaceRevivedEventData = z.infer<
  typeof personalWorkspaceRevivedEventDataSchema
>;

/** The owner switched their personal workspace's features; project stores them on its project. */
export const PERSONAL_WORKSPACE_FEATURES_CHANGED_EVENT_TYPE =
  "lw.organization.personal_workspace_features_changed" as const;

const personalWorkspaceFeaturesChangedEventDataSchemaDefinition = z.object({
  tenantId: z.string().min(1),
  organizationId: z.string().min(1).nullable(),
  userId: z.string().min(1),
  projectId: z.string().min(1),
  features: personalFeaturesSchema,
  occurredAt: z.number().int().nonnegative(),
});
export interface PersonalWorkspaceFeaturesChangedEventDataSchema extends Named<
  typeof personalWorkspaceFeaturesChangedEventDataSchemaDefinition
> {}
export const personalWorkspaceFeaturesChangedEventDataSchema: PersonalWorkspaceFeaturesChangedEventDataSchema =
  personalWorkspaceFeaturesChangedEventDataSchemaDefinition;
export type PersonalWorkspaceFeaturesChangedEventData = z.infer<
  typeof personalWorkspaceFeaturesChangedEventDataSchema
>;
