/** Shared epoch capability used to invalidate authorization snapshots. */
export abstract class AuthzEpochPort {
  /** Null disables snapshot caching and forces an authoritative read. */
  abstract read(input: { organizationId: string }): Promise<number | null>;

  /** Implementations preserve grant writes when cache bookkeeping fails. */
  abstract bump(input: { organizationId: string }): Promise<void>;
}
