/**
 * The per-user session version a browser's session-tier cache is stamped
 * with (ADR-164). Monotonic; a user never bumped answers 0. Kept in Redis,
 * or in memory by a process without it.
 */
export abstract class AuthzSessionVersionRepository {
  /** Throws when the store cannot answer: a guessed version could revalidate a stale read. */
  abstract getVersion(input: { userId: string }): Promise<number>;

  /** Throws on failure, so the subscriber that bumps is retried. */
  abstract bump(input: { userIds: readonly string[] }): Promise<void>;
}
