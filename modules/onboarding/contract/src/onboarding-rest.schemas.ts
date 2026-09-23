/** The `/api/v1/onboarding/guided` REST door's own parameters and credential. */
import { z } from "zod";

export const guidedPathRestParamsSchema = z.object({
  path: z.string().min(1).describe("The onboarding path: llmops, coding, gateway or governance."),
});

/** The resolved credential the door reads: an organization, and its user when one is bound. */
export const onboardingRestCredentialSchema = z.object({
  organizationId: z.string(),
  userId: z.string().nullable(),
});
export type OnboardingRestCredential = z.infer<typeof onboardingRestCredentialSchema>;
