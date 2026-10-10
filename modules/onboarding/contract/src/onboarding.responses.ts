import type { Named } from "@langwatch/module";
/** Contract schemas for the onboarding ceremony's tRPC responses. */
import { z } from "zod";

import { guidedPathSchema } from "./onboarding-guided-paths.ts";
import { onboardingVariantSchema } from "./onboarding-schemas.ts";

/**
 * The organization and its first team were created; `projectSlug` is null
 * for the coding-agent track, which is how the client knows to land on the
 * personal portal instead of a project.
 */
const organizationInitializedSchemaDefinition = z
  .object({
    success: z.literal(true),
    teamSlug: z.string().min(1),
    teamName: z.string(),
    teamId: z.string().min(1),
    organizationId: z.string().min(1),
    projectSlug: z.string().nullable(),
  })
  .strict();
export interface OrganizationInitializedSchema extends Named<
  typeof organizationInitializedSchemaDefinition
> {}
export const organizationInitializedSchema: OrganizationInitializedSchema =
  organizationInitializedSchemaDefinition;
export type OrganizationInitialized = z.infer<typeof organizationInitializedSchema>;

/** A write with nothing else to report. */
const onboardingWriteAckSchemaDefinition = z.object({ success: z.literal(true) }).strict();
export interface OnboardingWriteAckSchema extends Named<
  typeof onboardingWriteAckSchemaDefinition
> {}
export const onboardingWriteAckSchema: OnboardingWriteAckSchema =
  onboardingWriteAckSchemaDefinition;
export type OnboardingWriteAck = z.infer<typeof onboardingWriteAckSchema>;

/** Where the organization's guided onboarding stands, read beside the checks. */
const guidedOnboardingCheckSchemaDefinition = z
  .object({
    /** Null for an organization that predates the experiment. */
    variant: onboardingVariantSchema.nullable(),
    /** The picks in pick order. */
    paths: z.array(guidedPathSchema),
    currentPath: guidedPathSchema.optional(),
    donePaths: z.array(guidedPathSchema),
  })
  .strict();
export interface GuidedOnboardingCheckSchema extends Named<
  typeof guidedOnboardingCheckSchemaDefinition
> {}
export const guidedOnboardingCheckSchema: GuidedOnboardingCheckSchema =
  guidedOnboardingCheckSchemaDefinition;
export type GuidedOnboardingCheck = z.infer<typeof guidedOnboardingCheckSchema>;

/**
 * How far a project has been set up. Each figure is counted by the module that
 * owns it; the step counts read "more than none", and `teamMembers` is the team's size.
 */
const integrationsCheckStatusSchemaDefinition = z
  .object({
    workflows: z.number(),
    customGraphs: z.number(),
    datasets: z.number(),
    onlineEvaluations: z.number(),
    simulations: z.number(),
    modelProviders: z.number(),
    prompts: z.number(),
    teamMembers: z.number(),
    firstMessage: z.boolean(),
    integrated: z.boolean(),
    guidedOnboarding: guidedOnboardingCheckSchema,
  })
  .strict();
export interface IntegrationsCheckStatusSchema extends Named<
  typeof integrationsCheckStatusSchemaDefinition
> {}
export const integrationsCheckStatusSchema: IntegrationsCheckStatusSchema =
  integrationsCheckStatusSchemaDefinition;
export type IntegrationsCheckStatus = z.infer<typeof integrationsCheckStatusSchema>;
