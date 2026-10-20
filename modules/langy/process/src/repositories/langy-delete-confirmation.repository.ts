import { z } from "zod";

import type { ConfirmTarget } from "../rules/langy-local-control-keys.rules.ts";
import type { LocalRecordLookup } from "./langy-local-call.repository.ts";

/** The conversation a Langy key works for, and the turn it was minted in when one was known. */
export const confirmKeyBindingSchema = z.object({
  projectId: z.string(),
  conversationId: z.string(),
  turnId: z.string().optional(),
});
export type ConfirmKeyBinding = z.infer<typeof confirmKeyBindingSchema>;

/**
 * What the delete confirmation keeps: which conversation each Langy key works for, the cards
 * already asking, which card was answered, and the unspent Yes clicks. Every write expires.
 * Spec: specs/langy/langy-delete-confirmation.feature
 */
export abstract class LangyDeleteConfirmationRepository {
  abstract saveKeyBinding(input: {
    apiKeyId: string;
    binding: ConfirmKeyBinding;
    ttlSeconds: number;
  }): Promise<void>;

  /** The binding; a miss when the key was never bound or the binding lapsed. */
  abstract lookupKeyBinding(apiKeyId: string): Promise<LocalRecordLookup<ConfirmKeyBinding>>;

  abstract saveGrant(input: { target: ConfirmTarget; ttlSeconds: number }): Promise<void>;

  abstract hasGrant(target: ConfirmTarget): Promise<boolean>;

  /** Spends one click for every target in one step, or spends none and answers false. */
  abstract consumeGrants(targets: readonly ConfirmTarget[]): Promise<boolean>;

  abstract savePendingCard(input: {
    target: ConfirmTarget;
    waitId: string;
    ttlSeconds: number;
  }): Promise<void>;

  /** The wait of the card last raised for this target, while its record lives. */
  abstract lookupPendingCard(target: ConfirmTarget): Promise<LocalRecordLookup<string>>;

  /** True for exactly one caller per card: the first answer, whichever way it arrived. */
  abstract claimCard(input: { waitId: string; ttlSeconds: number }): Promise<boolean>;
}
