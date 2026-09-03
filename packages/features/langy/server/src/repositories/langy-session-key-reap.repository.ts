/**
 * The one write the fleet-wide session-key sweep performs.
 *
 * Separate from `LangySessionKeyRepository` because the sweep holds no project
 * and no organization: minting reads a project's scope and revoking reads one
 * key by id, and a process that only sweeps would have to compose both to reach
 * this single bounded `updateMany`. Every session-key repository can answer it —
 * `LangySessionKeyRepository` extends this one — so nothing is duplicated by
 * naming the narrow half on its own.
 */
export abstract class LangySessionKeyReapRepository {
  /**
   * Revokes every elapsed, unrevoked key carrying `name`; answers how many.
   *
   * The name is a parameter rather than a constant here because a repository
   * states what a query does, not which keys a policy may touch. The reserved
   * name is chosen one layer up, where a caller has no argument with which to
   * widen it.
   */
  abstract revokeExpiredByName(input: { name: string; now: Date }): Promise<number>;
}
