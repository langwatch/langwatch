/**
 * The Operators page's wire: who holds the platform-operator grant, and the
 * grant and revoke it offers. ARCHITECTURE.md, "Platform operators are a grant".
 */
import { Temporal } from "@langwatch/time";
import { z } from "zod";

/** One live holder, named for the page. */
export const opsPlatformOperatorSchema = z
  .object({
    grantId: z.string().min(1),
    userId: z.string().min(1),
    name: z.string().nullable(),
    email: z.string().nullable(),
    grantedAt: z.instanceof(Temporal.Instant),
  })
  .strict();
export type OpsPlatformOperator = z.infer<typeof opsPlatformOperatorSchema>;

export const opsPlatformOperatorListSchema = z.array(opsPlatformOperatorSchema);

/** Existing accounts only: the address is looked up, never invited. */
export const opsGrantPlatformOperatorInputSchema = z
  .object({ email: z.string().trim().min(1).max(320) })
  .strict();
export type OpsGrantPlatformOperatorInput = z.infer<typeof opsGrantPlatformOperatorInputSchema>;

export const opsRevokePlatformOperatorInputSchema = z
  .object({ grantId: z.string().min(1) })
  .strict();
export type OpsRevokePlatformOperatorInput = z.infer<typeof opsRevokePlatformOperatorInputSchema>;
