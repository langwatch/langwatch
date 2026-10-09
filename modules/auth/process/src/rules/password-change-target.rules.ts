/**
 * Which password a change rewrites (D09): a local password wins wherever one
 * exists; the broker answers only for somebody holding nothing else, which with
 * the switch off is everybody, so the old answer is preserved exactly.
 */
export function changeTargetsBrokeredPassword({
  provider,
  holdsOwnPassword,
}: {
  /** The deployment's resolved provider. */
  provider: string;
  /** Whether this person holds a password in this deployment's own rows. */
  holdsOwnPassword: boolean;
}): boolean {
  return provider === "auth0" && !holdsOwnPassword;
}
