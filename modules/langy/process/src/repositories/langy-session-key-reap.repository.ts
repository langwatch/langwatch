/** The one write the fleet-wide session-key sweep performs. Separate from LangySessionKeyRepository
 * because the sweep holds no project/organization; named narrowly to avoid duplication. */

import type { Instant } from "@langwatch/time";
export abstract class LangySessionKeyReapRepository {
  /**
   * Revokes every elapsed, unrevoked key carrying `name`; answers how many.
   * The name is a parameter, not a constant: a repository states what a
   * query does, not which keys a policy may touch - that choice lives up one layer.
   */
  abstract revokeExpiredByName(input: { name: string; now: Instant }): Promise<number>;
}
