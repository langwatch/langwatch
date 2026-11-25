// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
/**
 * What to say before somebody presses "Test sign-in" on a connection that is
 * not live yet. While a connection is being set up the gate accepts exactly
 * one address — the one belonging to whoever registered it — and everything
 * else is refused, including a colleague's and any address on the very domain
 * the connection is for. Said before the button rather than after it.
 */

/** A live connection accepts every address on the domains it proved. */
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
 * The note to show, or null when there is nothing worth saying. Nothing is
 * said for a live connection, where the one-address rule has stopped applying,
 * nor when we do not know the reader's address — every sentence names it.
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

  const connectionDomains = verifiedDomains
    .map((domain) => domain.trim().toLowerCase())
    .filter((domain) => domain.length > 0);

  // "Off domain" only means something once the connection HAS a domain: one
  // that has proved none is not yet set up for anywhere.
  const yourDomain = domainOf(address);
  const addressIsOffDomain =
    connectionDomains.length > 0 && yourDomain !== null && !connectionDomains.includes(yourDomain);

  return {
    tone: addressIsOffDomain ? "warning" : "info",
    yourAddress: address,
    connectionDomains,
    addressIsOffDomain,
  };
}
