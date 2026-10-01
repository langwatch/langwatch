import { z } from "zod";

/** How long a run's key lives when no caller needs it to outlast a longer bound. */
export const RUN_KEY_LIFETIME_MS = 15 * 60 * 1000;

/** The longest life a caller may ask a handed-out run key to still have; a run outliving it is refused. */
export const RUN_KEY_MAX_REMAINING_MS = 60 * 60 * 1000;

/** All a code agent's sandbox reaches: the project's agent cache, which user code may read. */
export const AGENT_SANDBOX_PERMISSIONS: readonly string[] = ["agentCache:manage"];

/** One run's key (ARCHITECTURE.md §10): the starter's, or nobody's when nobody started it. */
export const mintRunKeyInputSchema = z
  .object({
    /** The member who started the run; null acts as the system and owns nothing. */
    userId: z.string().min(1).nullable(),
    /** The key the run was started with, whose own permissions also bound the run's key. */
    callerApiKeyId: z.string().min(1).nullable().optional(),
    projectId: z.string().min(1),
    permissions: z.array(z.string().min(1)).min(1),
    /** The life the handed-out key must still have: the bound of whatever will hold it. */
    minRemainingMs: z.number().int().positive().max(RUN_KEY_MAX_REMAINING_MS).optional(),
  })
  .strict();
export type MintRunKeyInput = z.infer<typeof mintRunKeyInputSchema>;
