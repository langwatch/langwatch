import { z } from "zod";
import { langyEgressAllowlistSchema } from "./langy.ts";

/** One chat message on the wire - role + opaque parts (bounded downstream). */
export const langyTurnMessageSchema = z.object({
  role: z.enum(["user", "assistant", "system"]),
  parts: z.array(z.record(z.string(), z.unknown())).default([]),
});

/**
 * Per-send model override from the sidebar picker. Shape-validated here; the value is checked
 * against the project's Langy VK allowlist in the service.
 */
export const langyModelOverrideSchema = z
  .string()
  .regex(
    /^[a-zA-Z0-9_-]+(?:\/[a-zA-Z0-9._:-]+)+$/,
    "modelOverride must be in 'provider/model' shape",
  )
  .max(200);

/** The `langyEgress.get` and `langyEgress.set` answer: the allowlist plus enforcement state. */
export const langyEgressStateSchema = z
  .object({ allowlist: langyEgressAllowlistSchema, enforcing: z.boolean() })
  .strict();

/** The `langyEgress.get` input. */
export const langyEgressGetInputSchema = z.object({ projectId: z.string() });

/** The `langyEgress.set` input. */
export const langyEgressSetInputSchema = z.object({
  projectId: z.string(),
  allowlist: langyEgressAllowlistSchema,
});
