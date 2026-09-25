/**
 * Every `onboarding.*` procedure, declared once. Each guided-onboarding
 * write is the organization's own state; the server authorizes the exact
 * organizationId before any read or write.
 * @see specs/features/onboarding/guided-onboarding-variant.feature
 */
import { defineTrpcContract } from "@langwatch/api/contract";
import { z } from "zod";

import {
  onboardingVariantSchema,
  guidedOnboardingStateSchema,
  signUpDataSchema,
} from "./onboarding-schemas.ts";
import { onboardingWriteAckSchema, organizationInitializedSchema } from "./onboarding.responses.ts";

const organizationIdInputSchema = z.object({ organizationId: z.string() }).strict();

export const recordPathsInputSchema = organizationIdInputSchema.safeExtend({
  paths: z.array(z.string()).min(1),
});
export const recordProviderInputSchema = organizationIdInputSchema.safeExtend({
  provider: z.string().min(1),
  model: z.string().min(1),
});
export const recordVirtualKeyRevealInputSchema = organizationIdInputSchema.safeExtend({
  name: z.string().min(1),
  preview: z.string().min(1),
  revealId: z.string().min(1),
});
export const recordTourInputSchema = organizationIdInputSchema.safeExtend({
  status: z.enum(["completed", "skipped", "replayed"]),
});
export const guidedPathInputSchema = organizationIdInputSchema.safeExtend({ path: z.string() });
export const attachConversationInputSchema = organizationIdInputSchema.safeExtend({
  conversationId: z.string().min(1),
});

export const guidedStateOutputSchema = guidedOnboardingStateSchema;
export const guidedStateWithInstanceOutputSchema = z.object({
  ...guidedOnboardingStateSchema.shape,
  gatewayUrl: z.string().optional(),
});
export const guidedStateWithVariantOutputSchema = z.object({
  ...guidedStateWithInstanceOutputSchema.shape,
  variant: onboardingVariantSchema.nullable(),
});

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
 * for rolling-deploy tolerance (ADR-038), and names the organization's intents
 * here because the organization's contract depends on this one.
 */
export const onboardingInitializeOrganizationInputSchema = z.object({
  orgName: z.string().optional(),
  phoneNumber: z.string().optional(),
  signUpData: signUpDataSchema.optional(),
  primaryIntent: z.enum(["AGENT_GOVERNANCE", "LLM_OPS"]).optional(),
  /** Absent leaves the sign-up data's own variant as it was. */
  onboardingVariant: onboardingVariantSchema.optional(),

  projectName: z.string().optional(),
  language: z.string().default("other"),
  framework: z.string().default("other"),
});
export type OnboardingInitializeOrganizationInput = z.infer<
  typeof onboardingInitializeOrganizationInputSchema
>;

const setIntegrationMethodInputSchema = z.object({
  integrationMethod: onboardingIntegrationMethodSchema,
});

export const onboardingTrpc = defineTrpcContract("onboarding")
  .query("getGuidedState")
  .withInput(organizationIdInputSchema)
  .withOutput(guidedStateWithVariantOutputSchema)

  .mutation("recordPaths")
  .withInput(recordPathsInputSchema)
  .withOutput(guidedStateOutputSchema)

  .mutation("recordProvider")
  .withInput(recordProviderInputSchema)
  .withOutput(guidedStateOutputSchema)

  .mutation("recordProviderSkipped")
  .withInput(organizationIdInputSchema)
  .withOutput(guidedStateOutputSchema)

  .mutation("recordVirtualKeyReveal")
  .withInput(recordVirtualKeyRevealInputSchema)
  .withOutput(guidedStateOutputSchema)

  .mutation("recordTour")
  .withInput(recordTourInputSchema)
  .withOutput(guidedStateOutputSchema)

  .mutation("beginPath")
  .withInput(guidedPathInputSchema)
  .withOutput(guidedStateWithInstanceOutputSchema)

  .mutation("completePath")
  .withInput(guidedPathInputSchema)
  .withOutput(guidedStateOutputSchema)

  .mutation("attachConversation")
  .withInput(attachConversationInputSchema)
  .withOutput(guidedStateOutputSchema)

  /** The sign-up ceremony: it runs before the caller belongs to any organization. */
  .mutation("initializeOrganization")
  .withInput(onboardingInitializeOrganizationInputSchema)
  .withOutput(organizationInitializedSchema)

  /**
   * Records the flavour the customer picked, separately from the ceremony:
   * the organization is created before that screen is shown.
   */
  .mutation("setIntegrationMethod")
  .withInput(setIntegrationMethodInputSchema)
  .withOutput(onboardingWriteAckSchema)
  .build();
