/**
 * The one session knob an organization admin sets. Zero means unbounded;
 * the upper bound is enforced by the service, not here, so the refusal and
 * its copy stay in one place.
 */
import { z } from "zod";

export const organizationSessionPolicySchema = z
  .object({ maxSessionDurationDays: z.number().int().nonnegative() })
  .strict();
export type OrganizationSessionPolicyShape = z.infer<typeof organizationSessionPolicySchema>;
