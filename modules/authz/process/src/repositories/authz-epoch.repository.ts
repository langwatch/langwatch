/**
 * The per-organization epoch a cached authorization snapshot is stamped
 * with. A repository, not a port: a deployment with Redis keeps the number
 * there, a process without one keeps it in memory - both answer the same.
 */
export abstract class AuthzEpochRepository {
  /** Null disables snapshot caching and forces an authoritative read. */
  abstract findEpoch(input: { organizationId: string }): Promise<number | null>;

  /** Implementations preserve grant writes when cache bookkeeping fails. */
  abstract bump(input: { organizationId: string }): Promise<void>;
}
