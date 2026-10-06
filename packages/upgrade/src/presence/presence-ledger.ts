import { z } from "zod";

import type { UpgradeLedgerRepository } from "../ledger.repository.ts";
import { upgradePresenceSchema } from "../ledger.ts";

/** What a serving process declares about itself; the ledger stamps the times. */
export const presenceDeclarationSchema = z.object({
  processId: z.string().min(1),
  role: z.string().min(1),
  image: z.string().min(1),
  release: upgradePresenceSchema.shape.release,
  steps: z.array(z.string().min(1)),
});
export type PresenceDeclaration = z.infer<typeof presenceDeclarationSchema>;

/**
 * The ledger's presence methods. `removePresence` is requested from mig-ledger-widen (handoff
 * mig-cloud-presence); until it lands the repository does not satisfy this port.
 */
export type PresenceLedger = Pick<UpgradeLedgerRepository, "writePresence" | "findLivePresence"> & {
  removePresence(input: { processId: string }): Promise<void>;
};
