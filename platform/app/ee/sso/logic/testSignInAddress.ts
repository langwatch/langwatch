/**
 * What to say before somebody presses "Test sign-in" on a connection that is
 * not live yet (specs/identity/sso-assertion-refusals.feature).
 *
 * WHY THIS EXISTS. While a connection is being set up, the gate accepts
 * exactly ONE address: the one belonging to whoever registered it. Everything
 * else is refused, including a colleague's address and including any address
 * on the very domain the connection is being built for. That is deliberate —
 * widening it to "any member" hands an administrator a colleague's session —
 * but it is also deeply unobvious, and the way people discover it is by being
 * bounced to their identity provider, signing in successfully, and coming
 * back to a refusal.
 *
 * So it is said BEFORE the button rather than after it. The refusal copy
 * explains what went wrong; this exists so that it does not have to.
 */

/** A live connection accepts every address on the domains it proved, so none
 *  of this applies to it. */
const LIVE = "ACTIVE";

export interface TestSignInAddressNote {
  /** Louder when we can see that the address will not be accepted. */
  tone: "info" | "warning";
  /** The address this test will actually accept, when we know it. */
  yourAddress: string | null;
  /** The domains the connection is being built for, when it has any. */
  connectionDomains: string[];
  /** Set when the reader's own address is on none of those domains. */
  addressIsOffDomain: boolean;
}

const domainOf = (address: string): string | null => {
  const at = address.lastIndexOf("@");
  if (at <= 0 || at === address.length - 1) return null;
  const domain = address
    .slice(at + 1)
    .trim()
    .toLowerCase();
  return domain.length > 0 ? domain : null;
};

/**
 * The note to show, or null when there is nothing worth saying.
 *
 * Nothing is said for a LIVE connection: the one-address rule has stopped
 * applying, so a warning about it would be false. Nothing is said when we do
 * not know the reader's address either, since every sentence worth writing
 * here names it.
 */
export function testSignInAddressNote({
  connectionState,
  verifiedDomains,
  yourAddress,
}: {
  connectionState: string;
  verifiedDomains: readonly string[];
  yourAddress: string | null | undefined;
}): TestSignInAddressNote | null {
  if (connectionState === LIVE) return null;

  const address = yourAddress?.trim().toLowerCase() ?? "";
  if (!address) return null;

  const connectionDomains = [...verifiedDomains]
    .map((domain) => domain.trim().toLowerCase())
    .filter((domain) => domain.length > 0);

  // "Off domain" only means something once the connection HAS a domain. A
  // connection that has proved none is not yet set up for anywhere, so an
  // address cannot be off it.
  const yourDomain = domainOf(address);
  const addressIsOffDomain =
    connectionDomains.length > 0 &&
    yourDomain !== null &&
    !connectionDomains.includes(yourDomain);

  return {
    // Warned rather than merely told: at this point we can see the address the
    // provider is most likely to assert is one the gate will turn away.
    tone: addressIsOffDomain ? "warning" : "info",
    yourAddress: address,
    connectionDomains,
    addressIsOffDomain,
  };
}
