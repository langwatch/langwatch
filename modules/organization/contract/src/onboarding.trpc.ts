/**
 * Every `onboarding.*` procedure, declared once. Both run before the caller
 * belongs to any organization, so neither has a scope to be checked at.
 */

import { defineTrpcContract } from "@langwatch/api/contract";
import { z } from "zod";

import { onboardingWriteAckSchema, organizationInitializedSchema } from "./onboarding.responses.ts";
import { organizationApiSignUpDataSchema } from "./organization.trpc.ts";
import { organizationIntentSchema } from "./organization.ts";

/**
 * The four keys the "pick your flavour" screen offers. The traits they map to
 * are the deployment's marketing vocabulary rather than this feature's, so
 * only the keys are named here.
 */
export const onboardingIntegrationMethodSchema = z.enum([
  "via-claude-code",
  "via-platform",
  "via-claude-desktop",
  "manually",
]);
export type OnboardingIntegrationMethod = z.infer<typeof onboardingIntegrationMethodSchema>;

/**
 * The whole sign-up ceremony in one request. `primaryIntent` stays optional
 * for rolling-deploy tolerance (ADR-038).
 */
export const onboardingInitializeOrganizationInputSchema = z.object({
  orgName: z.string().optional(),
  phoneNumber: z.string().optional(),
  signUpData: organizationApiSignUpDataSchema.optional(),
  primaryIntent: organizationIntentSchema.optional(),

  projectName: z.string().optional(),
  language: z.string().default("other"),
  framework: z.string().default("other"),
});
export type OnboardingInitializeOrganizationInput = z.infer<
  typeof onboardingInitializeOrganizationInputSchema
>;

export const onboardingSetIntegrationMethodInputSchema = z.object({
  integrationMethod: onboardingIntegrationMethodSchema,
});
export type OnboardingSetIntegrationMethodInput = z.infer<
  typeof onboardingSetIntegrationMethodInputSchema
>;

export const onboardingTrpc = defineTrpcContract("onboarding")
  .mutation("initializeOrganization")
  .withInput(onboardingInitializeOrganizationInputSchema)
  .withOutput(organizationInitializedSchema)

  /**
   * Records the flavour the customer picked, separately from the ceremony:
   * the organization is created before that screen is shown.
   */
  .mutation("setIntegrationMethod")
  .withInput(onboardingSetIntegrationMethodInputSchema)
  .withOutput(onboardingWriteAckSchema)
  .build();
