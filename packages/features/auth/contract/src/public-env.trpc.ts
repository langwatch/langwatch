/**
 * `publicEnv`: the sign-in mode, and whether this viewer sees the operator
 * entry. ONE PROCEDURE, NAMED FOR ITSELF: the browser calls it at the ROOT,
 * so a process merges this declaration into its root rather than nesting it.
 */
import { defineTrpcContract } from "@langwatch/api/contract";
import { z } from "zod";

/**
 * Permissive on purpose: clients have historically sent whatever they had to
 * hand, and refusing them now would sign nobody in.
 */
export const publicEnvInputSchema = z.object({}).passthrough();

/** What the browser reads off this answer. */
export const publicEnvAnswerSchema = z.object({
  NEXTAUTH_PROVIDER: z.string(),
  SHOW_OPS_IN_MAIN_SIDEBAR: z.boolean(),
});
export type PublicEnvAnswer = z.infer<typeof publicEnvAnswerSchema>;

export const publicEnvTrpc = defineTrpcContract("publicEnv")
  .query("publicEnv")
  .withInput(publicEnvInputSchema)
  .withOutput(publicEnvAnswerSchema)
  .build();
