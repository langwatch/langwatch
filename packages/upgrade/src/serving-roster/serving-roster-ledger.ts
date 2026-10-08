import { z } from "zod";

import type { UpgradeLedgerRepository } from "../ledger.repository.ts";
import { servingRosterEntrySchema } from "../ledger.ts";

/** What a serving process declares about itself; the ledger stamps the times. */
export const servingRosterDeclarationSchema = z.object({
  processId: z.string().min(1),
  role: z.string().min(1),
  image: z.string().min(1),
  release: servingRosterEntrySchema.shape.release,
  steps: z.array(z.string().min(1)),
});
export type ServingRosterDeclaration = z.infer<typeof servingRosterDeclarationSchema>;

/**
 * The ledger's roster methods. `removeRosterEntry` is requested from mig-ledger-widen (handoff
 * mig-cloud-presence); until it lands the repository does not satisfy this port.
 */
export type ServingRosterLedger = Pick<
  UpgradeLedgerRepository,
  "writeRosterEntry" | "findLiveRoster"
> & {
  removeRosterEntry(input: { processId: string }): Promise<void>;
  /** Deletes entries dead for `deadForMs` (plan 2026-10-08 F-10); absent, nothing is pruned. */
  pruneRoster?(input: { deadForMs: number }): Promise<number>;
};
