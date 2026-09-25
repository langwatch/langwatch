/**
 * Where somebody goes who belongs to no organization.
 *
 * BELONGING TO NOTHING HAS TWO CAUSES and only one of them is a new customer.
 * The other is an administrator part-way through proving their own single
 * sign-on connection: going live requires a test sign-in, that sign-in
 * necessarily happens before the connection is live, and nobody is
 * provisioned through a connection that is not live — so it leaves them
 * holding a session with no membership, which is indistinguishable from a
 * fresh signup unless somebody asks.
 *
 * Offering that person the organization bootstrap reads as "your test failed,
 * start again from nothing", and taking it strands the setup they were two
 * steps from finishing inside a second, empty organization.
 *
 * The answer comes from the server (`identity.myTestArrival`) and never from
 * the query string: the setup screen marks its own callback URL so it can
 * tell whose `?error=` is on the page, and that marker is set and read in the
 * browser, which makes it fine for choosing a card and useless as evidence.
 */
export function resolveOrglessDestination({
  isPending,
  isTestArrival,
}: {
  /** The question is still out. Null holds the redirect rather than racing
   *  it to the bootstrap screen and navigating twice. */
  isPending: boolean;
  isTestArrival: boolean;
}): string | null {
  if (isPending) return null;
  if (isTestArrival) return "/auth/sso-test-complete";
  return "/onboarding/welcome";
}
