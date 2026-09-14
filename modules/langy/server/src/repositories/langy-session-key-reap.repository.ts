/** The one write the fleet-wide session-key sweep performs. Separate from LangySessionKeyRepository
 * because the sweep holds no project/organization; named narrowly to avoid duplication. */

import type { Instant } from "@langwatch/time";
export abstract class LangySessionKeyReapRepository {
  /**
   * Revokes every elapsed, unrevoked key carrying `name`; answers how many.
   *
   * The name is a parameter rather than a constant here because a repository
   * states what a query does, not which keys a policy may touch. The reserved
   * name is chosen one layer up, where a caller has no argument with which to
   * widen it.
   */
  abstract revokeExpiredByName(input: { name: string; now: Instant }): Promise<number>;
}
