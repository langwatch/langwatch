/**
 * The per-organization epoch a cached authorization snapshot is stamped with.
 *
 * It is a repository rather than a port because the number is a stored row:
 * a deployment with Redis keeps it there, a process without one keeps it in
 * memory, and both answer the same two questions.
 */
export abstract class AuthzEpochRepository {
  /** Null disables snapshot caching and forces an authoritative read. */
  abstract findEpoch(input: { organizationId: string }): Promise<number | null>;

  /** Implementations preserve grant writes when cache bookkeeping fails. */
  abstract bump(input: { organizationId: string }): Promise<void>;
}
