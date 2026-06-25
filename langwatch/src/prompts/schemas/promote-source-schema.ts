import { z } from "zod";

/**
 * Audit trail metadata for a prompt tag assignment that was produced by an
 * automated promotion flow. Persisted on `PromptTagAssignment.source` and
 * surfaced on the prompt version history UI as a chip linking back to the
 * originating event.
 *
 * Currently the only `kind` is `pairwise-eval` (#5104). Adding new kinds
 * (e.g. `regression-monitor`, `manual-override`) is a discriminated-union
 * extension — append a new branch and existing branches keep parsing.
 */
export const promoteSourceSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("pairwise-eval"),
    evalId: z.string(),
    experimentId: z.string(),
    runId: z.string().optional(),
  }),
]);

export type PromoteSource = z.infer<typeof promoteSourceSchema>;
