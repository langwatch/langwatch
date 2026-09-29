/**
 * Which password a change is about to rewrite (D09).
 *
 * For as long as a deployment brokering through Auth0 could hold no password
 * of its own, "what does this deployment federate with" and "where does this
 * person's password live" were the same question, and `user.changePassword`
 * answered it by reading the provider alone. That was correct, and it stopped
 * being correct the moment a deployment could issue its own passwords beside
 * the broker.
 *
 * Read the provider alone after that and two things go wrong, in opposite
 * directions. Somebody holding a password of OURS is sent to the broker,
 * which looks for an `auth0|` row, finds none, and refuses to change the
 * password they just set. Somebody holding BOTH has the broker's copy
 * rewritten while ours is left alone — worse than the refusal, because it
 * reports success for a change their next sign-in will not see.
 *
 * So the question is asked of the person, not the deployment. A local
 * password is the one this deployment authenticates with, so it wins
 * wherever one exists; the broker answers only for somebody who has nothing
 * else — which, on a deployment that never turned the switch on, is
 * everybody, so the old answer is preserved exactly.
 */
export function changeTargetsBrokeredPassword({
  provider,
  holdsOwnPassword,
}: {
  /** The deployment's resolved provider, as `resolveAuthProvider()` answers. */
  provider: string;
  /** Whether this person holds a password in this deployment's own rows. */
  holdsOwnPassword: boolean;
}): boolean {
  return provider === "auth0" && !holdsOwnPassword;
}
