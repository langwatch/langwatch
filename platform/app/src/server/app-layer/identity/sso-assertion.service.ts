import { extractEmailDomain } from "@ee/sso/matching";
import { normalizeDomain } from "@langwatch/identity";
import { looksLikeSsoConnectionId } from "@langwatch/identity-server";

/**
 * One connection, as the two sign-in decisions read it.
 *
 * Both used to select their own subset of the same row, and the two subsets
 * drifted: the gate never learned about `lapsedDomains` and the arrival never
 * learned about `createdBy`. One shape, read once, and each decision says
 * which parts of it it acts on.
 */
export interface SignInConnection {
  organizationId: string;
  state: string;
  verifiedDomains: readonly string[];
  lapsedDomains: readonly string[];
  arrivalPolicy: string;
  createdBy: string | null;
}

export interface SignInConnectionReadsPort {
  /** The connection an assertion names, or null when we hold no such row. */
  findConnectionForSignIn(args: {
    connectionId: string;
  }): Promise<SignInConnection | null>;
}

export interface SsoRegistrantMembershipPort {
  /**
   * Whether this address belongs to the named person, who is still a member
   * of the named organization.
   */
  findRegistrantAtAddress(args: {
    organizationId: string;
    userId: string;
    email: string;
  }): Promise<boolean>;
}

/**
 * What one connection's stored state says about one domain — the single
 * reading both sign-in decisions make of it.
 *
 * Three facts rather than one verdict, because the two decisions weigh them
 * differently and ADR-123 says they must: a lapsed domain still ROUTES, so
 * people who already work there keep signing in, and stops PROVISIONING, so
 * it admits nobody new. Collapsing them to "may this connection act on this
 * domain" would make one of the two wrong.
 */
export const domainStanding = ({
  connection,
  domain,
}: {
  connection: Pick<
    SignInConnection,
    "state" | "verifiedDomains" | "lapsedDomains"
  >;
  domain: string;
}): { live: boolean; proved: boolean; lapsed: boolean } => ({
  live: connection.state === "ACTIVE",
  proved: connection.verifiedDomains.includes(domain),
  lapsed: connection.lapsedDomains.includes(domain),
});

export interface SsoAssertionServiceDeps {
  connections: SignInConnectionReadsPort;
  memberships: SsoRegistrantMembershipPort;
}

/**
 * Whether an assertion from a customer's identity provider may become a
 * session at all — asked BEFORE better-auth links it to anybody.
 *
 * This is the only place that asks. `SsoArrivalService` compares the asserted
 * domain against the connection's proved domains too, but it runs after the
 * link has already happened, and it decides organization membership rather
 * than identity. That ordering was an account takeover: `trustEmailVerified`
 * makes `emailVerified` the CUSTOMER'S OWN identity provider's word,
 * better-auth links a verified address onto an existing user, and a
 * connection is dialable from DRAFT — so anybody who could register a
 * connection could point it at a server they control, assert
 * `someone-else@their-company.com` with `email_verified: true`, and be handed
 * that person's session.
 */
export class SsoAssertionService {
  constructor(private readonly deps: SsoAssertionServiceDeps) {}

  /**
   * Two questions, and the second is why this is not simply "is the domain
   * proved":
   *
   *   - A LIVE connection may only assert addresses on domains it has proved.
   *     Nothing else is defensible; the proof is the entire basis for trusting
   *     the flag.
   *
   *   - A connection that is NOT live may only assert ONE address: the one
   *     belonging to the administrator who registered it. This is the setup
   *     journey and nothing wider: activation refuses without a real sign-in
   *     through the connection (`SsoActivationTestSignInMissingError`), so the
   *     administrator doing the setup has to be able to sign in before the
   *     domain is proved — and proving the round trip works takes exactly one
   *     person, the one doing it.
   *
   *     ANY MEMBER IS NOT THE RULE, and reading it that way was an account
   *     takeover of a colleague. An administrator holding `sso:manage` can
   *     point a DRAFT connection at a server they control; if the gate admits
   *     every address in their organization, they assert a co-worker's address
   *     with `email_verified: true` and are handed that co-worker's session —
   *     including the co-worker's access to every OTHER organization and
   *     project they belong to, which the administrator never had. The threat
   *     the setup exemption has to survive is a colleague, not a stranger.
   *
   * The refusal is deliberately one code for every cause. Which of the two
   * questions failed is not something an unauthenticated caller gets to learn.
   */
  async decide({
    providerId,
    email,
  }: {
    providerId: string;
    email: string | null | undefined;
  }): Promise<{ action: "continue" } | { action: "reject"; code: string }> {
    // A code the client registry already has words for; the words are the
    // ones a person who was refused at a customer's identity provider needs.
    const refuse = {
      action: "reject",
      code: "identity_sign_in_refused",
    } as const;
    const carryOn = { action: "continue" } as const;

    // Not a connection at all: the deployment's own brokered provider and the
    // generic OAuth path do not come through this plugin, and an id that is not
    // a connection's reaching it is not something to wave past.
    if (!looksLikeSsoConnectionId(providerId)) return refuse;

    const raw = extractEmailDomain(email);
    if (!raw) return refuse;
    // Folded the way a claimed domain is folded, or a trailing dot and a
    // unicode homograph both compare unequal to the domain they impersonate.
    const domain = normalizeDomain(raw);

    const connection = await this.deps.connections.findConnectionForSignIn({
      connectionId: providerId,
    });
    if (!connection) return refuse;

    // A lapsed domain is not consulted here on purpose (ADR-123): the people
    // who already work there keep signing in.
    const standing = domainStanding({ connection, domain });
    if (standing.live) return standing.proved ? carryOn : refuse;

    // A connection nobody is recorded as having registered has no setup
    // administrator to make an exception for. Grandfathered connections end
    // ACTIVE and never reach here, so this is a row that should not exist
    // rather than a shape to wave through.
    if (!connection.createdBy) return refuse;

    const setupAdministrator =
      await this.deps.memberships.findRegistrantAtAddress({
        organizationId: connection.organizationId,
        userId: connection.createdBy,
        email: email ?? "",
      });
    return setupAdministrator ? carryOn : refuse;
  }
}
