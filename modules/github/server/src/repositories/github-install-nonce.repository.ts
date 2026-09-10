/**
 * The one-shot nonces the GitHub App installation flow mints. A nonce is a row
 * with a lifetime, written when the popup opens and consumed exactly once when
 * GitHub redirects back, so a replayed Setup URL cannot record an installation
 * twice.
 */
export abstract class GithubInstallNonceRepository {
  /**
   * Registers a nonce for its lifetime. False when no store answered, which
   * the flow reads as "this process cannot judge replay" rather than as a
   * refusal to install.
   */
  abstract registerNonce(input: { nonce: string; ttlSec: number }): Promise<boolean>;

  /**
   * Consumes a nonce once: true when this caller took it, false when it was
   * never registered or is already spent, and null when no store could answer,
   * which the flow reads as "replay cannot be judged here".
   */
  abstract consumeNonce(nonce: string): Promise<boolean | null>;
}
