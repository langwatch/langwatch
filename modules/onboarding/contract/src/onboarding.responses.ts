/** Contract schemas for the onboarding ceremony's tRPC responses. */
import { z } from "zod";

import { guidedPathSchema } from "./onboarding-guided-paths.ts";
import { onboardingVariantSchema } from "./onboarding-schemas.ts";

/**
 * The organization and its first team were created; `projectSlug` is null
 * for the coding-agent track, which is how the client knows to land on the
 * personal portal instead of a project.
 */
export const organizationInitializedSchema = z
  .object({
    success: z.literal(true),
    teamSlug: z.string().min(1),
    teamName: z.string(),
    teamId: z.string().min(1),
    organizationId: z.string().min(1),
    projectSlug: z.string().nullable(),
  })
  .strict();
export type OrganizationInitialized = z.infer<typeof organizationInitializedSchema>;

/** A write with nothing else to report. */
export const onboardingWriteAckSchema = z.object({ success: z.literal(true) }).strict();
export type OnboardingWriteAck = z.infer<typeof onboardingWriteAckSchema>;

/** Where the organization's guided onboarding stands, read beside the checks. */
export const guidedOnboardingCheckSchema = z
  .object({
    /** Null for an organization that predates the experiment. */
    variant: onboardingVariantSchema.nullable(),
    /** The picks in pick order. */
    paths: z.array(guidedPathSchema),
    currentPath: guidedPathSchema.optional(),
    donePaths: z.array(guidedPathSchema),
  })
  .strict();
export type GuidedOnboardingCheck = z.infer<typeof guidedOnboardingCheckSchema>;

/**
 * How far a project has been set up. Each figure is counted by the module that
 * owns it; the step counts read "more than none", and `teamMembers` is the team's size.
 */
export const integrationsCheckStatusSchema = z
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
export type IntegrationsCheckStatus = z.infer<typeof integrationsCheckStatusSchema>;
