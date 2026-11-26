import type { Named } from "@langwatch/module";
// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import { z } from "zod";

/**
 * What an admin tried when billing refused a seat change for two live subscriptions, kept so
 * the admin can be told once billing works again (specs/licensing/proration-preview.feature).
 */
const blockedSeatChangeAttemptSchemaDefinition = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("role_change"),
    memberName: z.string().min(1).max(200),
    /** The role as the members page names it, such as "Admin". */
    role: z.string().min(1).max(60),
  }),
  z.object({ kind: z.literal("seat_purchase"), seats: z.number().int().positive() }),
]);
export interface BlockedSeatChangeAttemptSchema extends Named<
  typeof blockedSeatChangeAttemptSchemaDefinition
> {}
export const blockedSeatChangeAttemptSchema: BlockedSeatChangeAttemptSchema =
  blockedSeatChangeAttemptSchemaDefinition;

export type BlockedSeatChangeAttempt = z.infer<typeof blockedSeatChangeAttemptSchema>;
