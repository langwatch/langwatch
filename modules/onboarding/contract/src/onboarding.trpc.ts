/**
 * Every `onboarding.*` procedure, declared once. Each guided-onboarding
 * write is the organization's own state; the server authorizes the exact
 * organizationId before any read or write.
 * @see specs/features/onboarding/guided-onboarding-variant.feature
 */
import { defineTrpcContract, type Named } from "@langwatch/module";
import { z } from "zod";

import {
  onboardingVariantSchema,
  guidedOnboardingStateSchema,
  signUpDataSchema,
} from "./onboarding-schemas.ts";
import {
  onboardingWriteAckSchema,
  organizationInitializedSchema,
  integrationsCheckStatusSchema,
} from "./onboarding.responses.ts";

const organizationIdInputSchema = z.object({ organizationId: z.string() }).strict();

const recordPathsInputSchemaDefinition = organizationIdInputSchema.safeExtend({
  paths: z.array(z.string()).min(1),
});
export interface RecordPathsInputSchema extends Named<typeof recordPathsInputSchemaDefinition> {}
export const recordPathsInputSchema: RecordPathsInputSchema = recordPathsInputSchemaDefinition;
const recordProviderInputSchemaDefinition = organizationIdInputSchema.safeExtend({
  provider: z.string().min(1),
  model: z.string().min(1),
});
export interface RecordProviderInputSchema extends Named<
  typeof recordProviderInputSchemaDefinition
> {}
export const recordProviderInputSchema: RecordProviderInputSchema =
  recordProviderInputSchemaDefinition;
const recordVirtualKeyRevealInputSchemaDefinition = organizationIdInputSchema.safeExtend({
  name: z.string().min(1),
  preview: z.string().min(1),
  revealId: z.string().min(1),
});
export interface RecordVirtualKeyRevealInputSchema extends Named<
  typeof recordVirtualKeyRevealInputSchemaDefinition
> {}
export const recordVirtualKeyRevealInputSchema: RecordVirtualKeyRevealInputSchema =
  recordVirtualKeyRevealInputSchemaDefinition;
const recordTourInputSchemaDefinition = organizationIdInputSchema.safeExtend({
  status: z.enum(["completed", "skipped", "replayed"]),
});
export interface RecordTourInputSchema extends Named<typeof recordTourInputSchemaDefinition> {}
export const recordTourInputSchema: RecordTourInputSchema = recordTourInputSchemaDefinition;
const guidedPathInputSchemaDefinition = organizationIdInputSchema.safeExtend({ path: z.string() });
export interface GuidedPathInputSchema extends Named<typeof guidedPathInputSchemaDefinition> {}
export const guidedPathInputSchema: GuidedPathInputSchema = guidedPathInputSchemaDefinition;
const attachConversationInputSchemaDefinition = organizationIdInputSchema.safeExtend({
  conversationId: z.string().min(1),
});
export interface AttachConversationInputSchema extends Named<
  typeof attachConversationInputSchemaDefinition
> {}
export const attachConversationInputSchema: AttachConversationInputSchema =
  attachConversationInputSchemaDefinition;

export const guidedStateOutputSchema = guidedOnboardingStateSchema;
const guidedStateWithInstanceOutputSchemaDefinition = z.object({
  ...guidedOnboardingStateSchema.shape,
  gatewayUrl: z.string().optional(),
});
export interface GuidedStateWithInstanceOutputSchema extends Named<
  typeof guidedStateWithInstanceOutputSchemaDefinition
> {}
export const guidedStateWithInstanceOutputSchema: GuidedStateWithInstanceOutputSchema =
  guidedStateWithInstanceOutputSchemaDefinition;
const guidedStateWithVariantOutputSchemaDefinition = z.object({
  ...guidedStateWithInstanceOutputSchema.shape,
  variant: onboardingVariantSchema.nullable(),
});
export interface GuidedStateWithVariantOutputSchema extends Named<
  typeof guidedStateWithVariantOutputSchemaDefinition
> {}
export const guidedStateWithVariantOutputSchema: GuidedStateWithVariantOutputSchema =
  guidedStateWithVariantOutputSchemaDefinition;

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
const onboardingInitializeOrganizationInputSchemaDefinition = z.object({
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
export interface OnboardingInitializeOrganizationInputSchema extends Named<
  typeof onboardingInitializeOrganizationInputSchemaDefinition
> {}
export const onboardingInitializeOrganizationInputSchema: OnboardingInitializeOrganizationInputSchema =
  onboardingInitializeOrganizationInputSchemaDefinition;
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

/**
 * The `integrationsChecks.*` namespace: one procedure, how far a project has
 * been set up. Main's onboarding checks; the evidence is counted by its owners.
 */

export const integrationsChecksTrpc = defineTrpcContract("integrationsChecks")
  .query("getCheckStatus")
  .withInput(z.object({ projectId: z.string() }))
  .withOutput(integrationsCheckStatusSchema)
  .build();
