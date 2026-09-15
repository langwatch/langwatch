/**
 * The one session knob an organization admin sets, as a schema.
 *
 * Zero means unbounded. The upper bound is enforced by the service rather than
 * stated here, so the refusal and the copy that explains it stay in one place.
 */
import { z } from "zod";

export const organizationSessionPolicySchema = z
  .object({ maxSessionDurationDays: z.number().int().nonnegative() })
  .strict();
export type OrganizationSessionPolicyShape = z.infer<typeof organizationSessionPolicySchema>;
