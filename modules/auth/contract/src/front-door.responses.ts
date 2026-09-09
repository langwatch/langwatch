/**
 * What the signed-out front door answers, as schemas.
 *
 * Every one of these is read by somebody with no session, so the shapes are
 * deliberately small: an acknowledgement, an address, and the two facts an
 * invitation link may say to whoever opens it. The routing decision itself is
 * NOT here — it is the identity feature's `routingDecisionSchema`, because
 * routing is its domain and the door only forwards it.
 */
import { z } from "zod";

/** A mail was asked for. The same answer whether or not one was needed. */
export const frontDoorSentSchema = z.object({ sent: z.literal(true) }).strict();
export type FrontDoorSent = z.infer<typeof frontDoorSentSchema>;

/** The admins were told somebody is waiting. Never says how many, or who. */
export const frontDoorAskedSchema = z.object({ asked: z.boolean() }).strict();
export type FrontDoorAsked = z.infer<typeof frontDoorAskedSchema>;

/**
 * What a spent confirmation link resolved to: the address it confirmed, and
 * whether spending it is what brought the account into being.
 */
export const signUpVerificationResultSchema = z
  .object({
    email: z.string(),
    accountCreated: z.boolean(),
    accountExists: z.boolean(),
  })
  .strict();
export type SignUpVerificationResult = z.infer<typeof signUpVerificationResultSchema>;

/**
 * What an invitation link may say to whoever opens it: which organization is
 * asking, and who asked. Enough to decide whether to accept, and nothing that
 * would make a guessed code worth guessing — no address, no role, no
 * membership.
 */
export const inviteLandingSchema = z
  .object({
    organizationName: z.string(),
    inviterName: z.string().nullable(),
    alreadyAccepted: z.boolean(),
  })
  .strict();
export type InviteLanding = z.infer<typeof inviteLandingSchema>;
