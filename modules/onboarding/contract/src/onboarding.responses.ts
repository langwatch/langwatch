/** Contract schemas for the onboarding ceremony's tRPC responses. */
import { z } from "zod";

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
