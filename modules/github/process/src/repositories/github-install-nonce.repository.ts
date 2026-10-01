/**
 * The one-shot nonces the GitHub App installation flow mints. A nonce is a
 * row with a lifetime, written when the popup opens and consumed exactly once
 * on GitHub's redirect, so a replayed Setup URL cannot record an install twice.
 */
export abstract class GithubInstallNonceRepository {
  /**
   * Registers a nonce for its lifetime. False when no store answered, which
   * the flow reads as "this process cannot judge replay" rather than as a
   * refusal to install.
   */
  abstract registerNonce(input: { nonce: string; ttlSec: number }): Promise<boolean>;

  /**
   * Consumes a nonce once: consumed when this caller took it, spent when it was
   * never registered or is already used, and unavailable when no store could
   * answer, which the flow reads as "replay cannot be judged here".
   */
  abstract consumeNonce(nonce: string): Promise<"consumed" | "spent" | "unavailable">;
}
