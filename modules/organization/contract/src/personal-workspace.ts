import { NotFoundError } from "@langwatch/handled-error";
import { z } from "zod";

export const personalWorkspaceInputSchema = z
  .object({
    userId: z.string().min(1),
    organizationId: z.string().min(1),
    displayName: z.string().nullable().optional(),
    displayEmail: z.string().nullable().optional(),
  })
  .strict();
export type PersonalWorkspaceInput = z.infer<typeof personalWorkspaceInputSchema>;

export const findPersonalWorkspaceInputSchema = z
  .object({
    userId: z.string().min(1),
    organizationId: z.string().min(1),
  })
  .strict();
export type FindPersonalWorkspaceInput = z.infer<typeof findPersonalWorkspaceInputSchema>;

export const personalWorkspaceSchema = z
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
export type PersonalWorkspace = z.infer<typeof personalWorkspaceSchema>;

export const ensuredPersonalWorkspaceSchema = personalWorkspaceSchema.safeExtend({
  created: z.boolean(),
});
export type EnsuredPersonalWorkspace = z.infer<typeof ensuredPersonalWorkspaceSchema>;

export const PERSONAL_FEATURES = ["evaluations", "datasets", "annotations", "automations"] as const;
export const personalFeatureSchema = z.enum(PERSONAL_FEATURES);
export type PersonalFeature = z.infer<typeof personalFeatureSchema>;

export const personalFeaturesSchema = z
  .object({
    evaluations: z.boolean(),
    datasets: z.boolean(),
    annotations: z.boolean(),
    automations: z.boolean(),
  })
  .strict();
export type PersonalFeatures = z.infer<typeof personalFeaturesSchema>;

export const personalWorkspaceFeaturesInputSchema = z
  .object({
    projectId: z.string().min(1),
    callerUserId: z.string().min(1),
  })
  .strict();
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

/** A newly created personal workspace, which project records as a created project (§9). */
export const PERSONAL_WORKSPACE_PROVISIONED_EVENT_TYPE =
  "lw.organization.personal_workspace_provisioned" as const;

/** Ids only: the tenant is the organization, and a peer reads the project through `ProjectApi`. */
export const personalWorkspaceProvisionedEventDataSchema = z.object({
  tenantId: z.string().min(1),
  organizationId: z.string().min(1),
  userId: z.string().min(1),
  projectId: z.string().min(1),
  occurredAt: z.number().int().nonnegative(),
});
export type PersonalWorkspaceProvisionedEventData = z.infer<
  typeof personalWorkspaceProvisionedEventDataSchema
>;
