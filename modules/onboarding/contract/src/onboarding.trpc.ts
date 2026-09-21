/**
 * Every `onboarding.*` procedure, declared once. Each guided-onboarding
 * write is the organization's own state; the server authorizes the exact
 * organizationId before any read or write.
 * @see specs/features/onboarding/guided-onboarding-variant.feature
 */
import { defineTrpcContract } from "@langwatch/api/contract";
import { z } from "zod";

import { onboardingVariantSchema, guidedOnboardingStateSchema } from "./onboarding-schemas.ts";

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
  .build();
