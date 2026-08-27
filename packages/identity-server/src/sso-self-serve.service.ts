import {
  type BreakGlassBinding,
  DEFAULT_SSO_ARRIVAL_POLICY,
  breakGlassDaysRemaining,
  breakGlassIsLive,
  domainClaimFor,
  normalizeDomain,
  SSO_DNS_PROOF_TTL_MS,
  SSO_DNS_RECORD_NAME,
  SSO_DNS_RECORD_TYPE,
  ssoArrivalPolicy,
  type SsoArrivalPolicy,
  type SsoConnectionState,
  type SsoConnectionType,
  type SsoDomainClaim,
  type SsoDomainProofState,
  type SsoSelfServeAvailability,
  type SsoSelfServeContext,
  SsoActivationArrivalsUndecidedError,
  SsoActivationBreakGlassMissingError,
  SsoActivationDomainUnprovedError,
  SsoActivationTestSignInMissingError,
  SsoConnectionAlreadyRegisteredError,
  SSO_VERIFICATION_FILE_PATH,
  SsoDomainClaimPendingError,
  SsoDomainFetchFailedError,
  SsoDomainFileNotFoundError,
  SsoDomainLookupFailedError,
  SsoDomainProofNotFoundError,
  ssoDnsRecordName,
  ssoVerificationFileUrl,
  SsoLicenseRequiredError,
  SsoSelfServeUnavailableError,
  ssoSelfServeAvailability,
  verificationHasExpired,
} from "@langwatch/identity";
import { mintVerificationToken, safeEqual, sha256Hex } from "./crypto/pkce";
import type { SsoCredentialStore } from "./sso-credential-store";
import {
  serviceProviderDetailsFor,
  type SsoServiceProviderDetails,
} from "./sso-engine-provider";
import {
  type SsoIdpRegistration,
  type SsoIssuerDiscoveryPort,
  validateOidcRegistration,
  validateSamlRegistration,
} from "./sso-idp-registration";
import { newSsoConnectionCommandId, newSsoConnectionId } from "./sso-connection-id";
import type { SsoConnectionReadRepository } from "./sso-connection.repository";
import type { SsoConnectionService } from "./sso-connection.service";

/** The states `activate_connection` accepts. Stated here so the checklist and
 *  the guard cannot drift into disagreeing about whether the button works. */
const ACTIVATABLE_STATES: readonly string[] = ["VERIFIED"];

/**
 * Self-serve single sign-on setup, tiers 2 and 3 (D05).
 *
 * One service for both tiers, because they are the same journey with two
 * answers to one question — what authorizes this domain. A self-hosted
 * installation's licence answers it in the same step as the claim; a hosted
 * organization's claim is answered by the record they publish, which decides
 * the claim and proves the domain in one act. Neither waits for anybody, and
 * a second class would be a second copy of the lifecycle.
 *
 * One claim still reaches a LangWatch operator, and exactly one: a claim on
 * a domain another organization has already proved. That is a dispute
 * between two customers, no record either of them publishes can settle it,
 * and it is the only thing the operator queue lists.
 *
 * It is a THIN caller of `SsoConnectionService`, exactly as the back office's
 * is: every change is one of the aggregate's guarded verbs with the
 * administrator recorded as the actor. Nothing here writes an `SsoConnection`
 * row, and nothing here re-decides what a guard decides — the availability
 * check below is a courtesy so a customer is told before they start, and the
 * guards refuse the same things independently for every caller the aggregate
 * will ever have.
 *
 * What this service can never do is attest a domain. Vouching for one is a
 * LangWatch operator's act on every deployment (D04 amendment), so there is
 * no verb for it here and no configuration that grows one.
 */

/**
 * What the installation and the organization are, asked fresh per call. A
 * port rather than four constructor arguments, because `licensed` is the
 * frozen startup answer ADR-027 owns and `optedIn` is a per-organization
 * flag read at request time — two different clocks that would be wrong
 * captured together.
 */
export interface SsoSelfServeContextPort {
  resolve(args: { organizationId: string }): Promise<SsoSelfServeContext>;
}

/**
 * What a lookup at the verification name found — and the reason there are
 * three answers rather than two.
 *
 * "Nothing is published there" and "we could not find out what is published
 * there" are different facts about the world, and only the first one is
 * something a customer can act on. A resolver that times out, refuses, or
 * answers SERVFAIL has told us nothing about the domain; reporting that as
 * an empty record set would tell an administrator their DNS is wrong when
 * ours is what could not answer.
 */
export type SsoDomainTxtLookup =
  /** The name resolved, and these are the values published at it. */
  | { outcome: "published"; values: string[] }
  /** The name resolved to nothing: no such name, or no TXT record on it. */
  | { outcome: "absent" }
  /** The lookup itself failed. This says nothing about the domain. */
  | { outcome: "unreachable"; reason: string };

/** Reading the record a customer published. Refusals are the caller's
 *  concern; this answers what is on the domain, that nothing is, or that it
 *  could not be asked. */
export interface SsoDomainProofLookup {
  /** Look the verification name up. `name` is passed rather than composed
   *  here so the one place that decides where the record lives is the
   *  identity vocabulary, not each adapter. */
  lookupTxtValues(args: {
    domain: string;
    name: string;
  }): Promise<SsoDomainTxtLookup>;
}

/**
 * What a fetch of the verification file found — the published proof's second
 * channel, with the TXT lookup's three answers and for the same reason.
 *
 * "Nothing is served there" (a clean not-found) is a fact about the
 * customer's web server and something they can act on; a connection that was
 * refused, timed out, or answered with a server error has told us nothing,
 * and reporting it as an absent file would send an administrator to re-deploy
 * a file that is already there. `values` is every non-empty line of the
 * body, so a file holding the token plus a trailing newline still matches.
 */
export type SsoDomainFileFetch =
  /** The path answered, and these are the lines it served. */
  | { outcome: "served"; values: string[] }
  /** The domain answered plainly that nothing is at the path. */
  | { outcome: "absent" }
  /** The fetch itself failed. This says nothing about the domain. */
  | { outcome: "unreachable"; reason: string };

/** Reading the verification file a customer serves. `url` is passed rather
 *  than composed here so the one place that decides where the file lives is
 *  the identity vocabulary, not each adapter. */
export interface SsoDomainFileLookup {
  fetchVerificationFile(args: {
    domain: string;
    url: string;
  }): Promise<SsoDomainFileFetch>;
}

/** The evidence a self-hosted installation's licence is. Never the licence
 *  key itself: what is recorded is a hash of it, and this is where the hash
 *  comes from. */
export interface SsoLicenseProofPort {
  /** The installation's licence key, or null when it holds none. */
  currentLicenseKey(): Promise<string | null>;
}

/** The administrator issuing a command, as the surface knows them. */
export interface SelfServeActor {
  userId: string;
}

/**
 * A sign-in that ACTUALLY happened through this connection.
 *
 * The evidence is the account the engine wrote when the identity provider
 * handed a person back — so there is no verb for "record the test login" and
 * cannot be one. A customer ticks this box by signing in; nothing they click
 * can tick it for them, and nothing we could write down would be more true
 * than the account itself.
 *
 * `accountId` is the account ROW's id rather than the subject the identity
 * provider asserted. Both identify the same sign-in; only one of them is
 * ours, and copying a provider's subject onto an organization-level fact
 * would put a person's identifier in the one aggregate that holds none.
 */
export interface SsoTestSignIn {
  accountId: string;
  userId: string;
  atMs: number;
}

/**
 * Whether anybody has come back through this connection.
 *
 * A port because the accounts are the engine's table and this package owns
 * no storage. Scoped to the ORGANIZATION as well as the connection so a
 * lookup that somehow answered with another organization's account cannot
 * become this organization's evidence.
 */
export interface SsoTestSignInLookup {
  findLatestForConnection(args: {
    organizationId: string;
    connectionId: string;
  }): Promise<SsoTestSignIn | null>;
}

/** Somebody in the organization, as the break-glass surface names them. */
export interface SsoOrganizationMember {
  userId: string;
  name: string | null;
  email: string | null;
}

/**
 * Who a way back in can be granted to, and who holds the ones that exist.
 *
 * Two reads rather than one because they answer different questions: the
 * candidates are the organization's administrators, and a holder may have
 * stopped being one since — a binding whose holder is no longer an
 * administrator is still a way in, and a list that quietly dropped them
 * would be a list nobody could audit.
 */
export interface SsoOrganizationMemberLookup {
  findAdministrators(args: {
    organizationId: string;
  }): Promise<SsoOrganizationMember[]>;
  findByIds(args: {
    organizationId: string;
    userIds: string[];
  }): Promise<SsoOrganizationMember[]>;
}

/** The bindings themselves, read-only. The write half is the break-glass
 *  service's, and the setup surface never reaches it. */
export interface SsoBreakGlassReadPort {
  history(args: { organizationId: string }): Promise<BreakGlassBinding[]>;
}

/** One domain's claim as the setup surface renders it. */
export interface SelfServeDomainClaimView {
  domain: string;
  state: SsoDomainClaim["state"];
  claimedAtMs: number;
  decidedAtMs: number | null;
  waitedMs: number | null;
  /** The reviewer's words, on a rejection — read back so a re-claim starts
   *  from what a human already said. */
  note: string | null;
  /**
   * Whether this claim is one a person has to decide.
   *
   * True of exactly one kind of waiting claim: one on a domain another
   * organization has already proved. Every other waiting claim is waiting for
   * the CUSTOMER — for a record they have not published yet — and telling
   * them we are reviewing it would be telling them to sit still when the next
   * move is theirs.
   */
  waitsForReview: boolean;
}

/**
 * The condition of one proved domain's evidence, as the settings surface
 * renders it (ADR-123). `graceEndsAtMs` is the deadline the customer was
 * told, so the screen and the email cannot disagree about it.
 */
export interface SelfServeDomainProofView {
  domain: string;
  proofState: SsoDomainProofState;
  graceEndsAtMs: number | null;
}

/**
 * Where the record goes and what kind it is: the half of the ceremony that
 * is not a secret, so it can be shown as often as the page is opened.
 *
 * Both names are answered because DNS control panels are split on which one
 * they want — some take a label relative to the zone, some a fully qualified
 * name — and an administrator who guesses wrong publishes a record at
 * `_langwatch-verification.acme.com.acme.com` and is told it is missing.
 */
export interface SelfServeDnsRecordLocation {
  domain: string;
  /** The label, relative to the zone: `_langwatch-verification`. */
  label: string;
  /** The whole name: `_langwatch-verification.acme.com`. */
  name: string;
  type: typeof SSO_DNS_RECORD_TYPE;
  /**
   * The same token's second channel: serve it as the entire body of a
   * plain-text file at this address instead of publishing the record — for
   * the customer whose DNS is a ticket away but whose web server is not.
   * Either channel satisfies the one outstanding ceremony.
   */
  file: {
    /** The path, relative to the domain: `/.well-known/…`. */
    path: string;
    /** The whole address the check fetches. */
    url: string;
  };
}

/** The record as the setup surface renders it while one is outstanding. */
export interface SelfServeDnsRecordView extends SelfServeDnsRecordLocation {
  /** Null once the value has been shown: the value is minted once and
   *  only its hash is kept, so a reload shows the record rather than the
   *  secret, and the customer asks for a fresh one if they lost it. */
  value: string | null;
  expiresAtMs: number | null;
  expired: boolean;
}

/** The record at the one moment its value exists: when it is issued. */
export interface SelfServeIssuedDnsRecord extends SelfServeDnsRecordLocation {
  value: string;
  expiresAtMs: number;
}

/**
 * The last step, as a checklist rather than as a verdict.
 *
 * All three preconditions are answered on every read, including once they
 * are met, because what the screen shows is a journey: a customer who has
 * done two of three needs to see the two that are done as well as the one
 * that is not. The refusals name one at a time; this names all of them.
 */
export interface SelfServeGoLiveView {
  domainProved: boolean;
  testSignIn: { done: boolean; atMs: number | null };
  breakGlass: { inPlace: boolean; liveCount: number };
  /**
   * Whether anybody has said what this connection does with somebody who
   * signs in through it and is not a member yet (ADR-117 §3).
   *
   * A PRECONDITION OF GOING LIVE, because the alternative is what shipped:
   * registration states `refuse`, the journey never mentioned it, and a
   * person signing in through their own organization's identity provider was
   * authenticated and then handed a brand new workspace of their own. Nobody
   * chose that. Turning a connection on without deciding what it admits is
   * choosing by not choosing, and this is the step that stops it.
   */
  arrivalsDecided: boolean;
  /** Every precondition met. Not the same as `activated`. */
  ready: boolean;
  activated: boolean;
}

/**
 * One way back in, as the setup surface lists it. Carries the holder's name
 * because "who can still get in without the identity provider" is the whole
 * question, and a list of user ids answers it for nobody.
 */
export interface SelfServeBreakGlassBindingView {
  bindingId: string;
  userId: string;
  name: string | null;
  email: string | null;
  grantedByUserId: string;
  grantedByName: string | null;
  grantedAtMs: number;
  expiresAtMs: number;
  supersededAtMs: number | null;
  /** A way in right now: not superseded, not past its end date. */
  live: boolean;
  daysRemaining: number;
}

/** Everything the settings surface needs, in one read. */
export interface SelfServeSetupView {
  availability: SsoSelfServeAvailability;
  /**
   * LangWatch's own side of the connection (D09).
   *
   * First in the payload because it is first on the screen: an administrator
   * cannot configure their identity provider from a form that only asks them
   * questions. Their side needs ours — where to send the assertion, what to
   * call us, where to send somebody back — and none of it depends on a
   * connection existing, so it is answered before one does.
   */
  serviceProvider: SsoServiceProviderDetails;
  connection: {
    connectionId: string;
    state: SsoConnectionState["state"];
    type: SsoConnectionType;
    providerId: string;
    issuer: string | null;
    /**
     * What happens to somebody who signs in through it and is not a member
     * yet. Always an answer, never null: registration states one, so a screen
     * never has to show "not set" for a behaviour that is very much set.
     */
    arrivalPolicy: SsoArrivalPolicy;
    /**
     * When a scheduled removal completes, and null while none is scheduled.
     *
     * On the view because the danger zone has to SAY it. A connection being
     * removed a week from now and one being removed in a minute are the same
     * state and very different news, and an administrator deciding whether to
     * call it off is deciding about a date.
     */
    tearDownAfterMs: number | null;
    verifiedDomains: string[];
    /** One entry per proved domain: what proved it is elsewhere, this is
     *  whether that evidence is still there. */
    domainProofs: SelfServeDomainProofView[];
  } | null;
  claims: SelfServeDomainClaimView[];
  /** The record to publish, while one is outstanding and unexpired. */
  record: SelfServeDnsRecordView | null;
  /** The last step's three preconditions. Null while there is no connection
   *  to go live with — the journey has not reached this step. */
  goLive: SelfServeGoLiveView | null;
  /** Whether vouching for the domain is something this administrator can
   *  reach. Always false: it is a LangWatch operator's act on every tier. */
  attestationOffered: false;
}

export interface SsoSelfServeServiceDeps {
  connections: () => SsoConnectionService;
  reads: SsoConnectionReadRepository;
  context: SsoSelfServeContextPort;
  proofs: SsoDomainProofLookup;
  /** The published proof's second channel: the file the domain serves. */
  files: SsoDomainFileLookup;
  license: SsoLicenseProofPort;
  /** Where a client secret or a SAML document goes, so the command can carry
   *  a reference to it instead (D09). */
  credentials: SsoCredentialStore;
  /** Whether an OpenID Connect issuer answers. A port because it is a
   *  network call. */
  discovery: SsoIssuerDiscoveryPort;
  /** Whether anybody has actually come back through the connection. */
  testSignIns: SsoTestSignInLookup;
  /** The ways back in, read-only. */
  breakGlass: SsoBreakGlassReadPort;
  /** Who they can be granted to, and who holds the ones that exist. */
  members: SsoOrganizationMemberLookup;
  /** The deployment's own address, which is what LangWatch is called to an
   *  identity provider. */
  baseUrl: string;
  now?: () => number;
}

export class SsoSelfServeService {
  private readonly now: () => number;

  constructor(private readonly deps: SsoSelfServeServiceDeps) {
    this.now = deps.now ?? Date.now;
  }

  /**
   * What the setup surface renders, refusal included.
   *
   * The read never throws for an unavailable installation: a customer who
   * cannot set single sign-on up needs to be TOLD why, which means the
   * screen has to render. The verbs below are what refuse.
   */
  async getSetup({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<SelfServeSetupView> {
    const availability = ssoSelfServeAvailability(
      await this.deps.context.resolve({ organizationId }),
    );
    const state = await this.deps.reads.findConnectionForOrganization({
      organizationId,
    });
    const nowMs = this.now();
    return {
      availability,
      serviceProvider: serviceProviderDetailsFor({
        baseUrl: this.deps.baseUrl,
        connectionId: state?.connectionId ?? null,
      }),
      connection: state
        ? {
            connectionId: state.connectionId,
            state: state.state,
            type: state.type,
            providerId: state.idpMetadata.providerId,
            issuer: state.idpMetadata.issuer,
            arrivalPolicy: ssoArrivalPolicy(state),
            tearDownAfterMs: state.tearDownAfterMs,
            verifiedDomains: state.verifiedDomains,
            domainProofs: state.domainVerifications.map((proof) => ({
              domain: proof.domain,
              proofState: proof.proofState,
              graceEndsAtMs: proof.graceEndsAtMs,
            })),
          }
        : null,
      // Whether a waiting claim is a PERSON's to decide is asked per claim
      // rather than assumed from the tier: a hosted claim waits for the
      // customer's own record unless another organization already holds the
      // domain, and telling somebody we are reviewing it when the next move
      // is theirs is how a customer waits for nothing.
      // A withdrawn claim is a tombstone the rate limit reads, not a domain
      // this connection has. It never reaches a screen.
      claims: await Promise.all(
        (state?.domainClaims ?? [])
          .filter((claim) => claim.state !== "WITHDRAWN")
          .map(async (claim) => ({
          ...toClaimView(claim),
          waitsForReview:
            claim.state === "WAITING" &&
            (await this.isDisputed({ organizationId, domain: claim.domain })),
          })),
      ),
      record:
        state?.pendingVerification &&
        state.pendingVerification.method === "dns-txt"
          ? {
              ...recordLocationFor({
                domain: state.pendingVerification.domain,
              }),
              value: null,
              expiresAtMs: state.pendingVerification.expiresAtMs,
              expired: verificationHasExpired({
                pending: state.pendingVerification,
                nowMs,
              }),
            }
          : null,
      goLive: state
        ? await this.goLiveFor({ organizationId, connection: state })
        : null,
      attestationOffered: false,
    };
  }

  /**
   * The three preconditions and where the rollout stands, as one read.
   *
   * Asked of the same places activation asks — the folded state's proved
   * domains, the account store, and the bindings themselves — so the
   * checklist and the refusal can never disagree about which step is
   * outstanding. A screen that showed a tick beside a step the mutation then
   * refuses is worse than no checklist at all.
   */
  private async goLiveFor({
    organizationId,
    connection,
  }: {
    organizationId: string;
    connection: SsoConnectionState;
  }): Promise<SelfServeGoLiveView> {
    const [testSignIn, liveBindings] = await Promise.all([
      this.deps.testSignIns.findLatestForConnection({
        organizationId,
        connectionId: connection.connectionId,
      }),
      this.liveBindings({ organizationId }),
    ]);
    const domainProved = connection.verifiedDomains.length > 0;
    // Somebody has SAID, which is not the same as the connection having an
    // answer — it always has one. A connection that predates the question is
    // on `refuse` and nobody chose it, and that is precisely the state this
    // precondition exists to interrupt.
    const arrivalsDecided = connection.arrivalPolicyDecidedAtMs !== null;
    return {
      domainProved,
      testSignIn: {
        done: testSignIn !== null,
        atMs: testSignIn?.atMs ?? null,
      },
      breakGlass: {
        inPlace: liveBindings.length > 0,
        liveCount: liveBindings.length,
      },
      arrivalsDecided,
      // AND IN A STATE ACTIVATION ACCEPTS. Every tick above is about a
      // precondition the customer can act on; the lifecycle is the one thing
      // the checklist cannot make true by listing it. Leaving it out let the
      // screen say ready while `activate_connection` — which accepts VERIFIED
      // and nothing else — answered a raw transition code naming no step, so
      // the button failed with nothing on screen to do about it.
      ready:
        domainProved &&
        testSignIn !== null &&
        liveBindings.length > 0 &&
        arrivalsDecided &&
        ACTIVATABLE_STATES.includes(connection.state),
      activated: connection.state === "ACTIVE",
    };
  }

  /**
   * Turn the connection on.
   *
   * The three preconditions are checked HERE so each can be refused by name,
   * and checked again in the guard so they hold for every caller the
   * aggregate will ever have. The order is the order the screen lists them
   * in, so the refusal a customer gets is the first outstanding step reading
   * down the page rather than whichever check happened to run first.
   *
   * A connection that is already ACTIVE costs nothing and states nothing:
   * two administrators pressing the button is one activation, not a refusal
   * one of them has to interpret.
   */
  async activate({
    organizationId,
    connectionId,
    actor,
  }: {
    organizationId: string;
    connectionId: string;
    actor: SelfServeActor;
  }): Promise<{ alreadyLive: boolean }> {
    await this.requireAvailable({ organizationId });
    const state = await this.requireOrganizationConnection({
      organizationId,
      connectionId,
    });
    if (state.state === "ACTIVE") return { alreadyLive: true };

    if (state.verifiedDomains.length === 0) {
      throw new SsoActivationDomainUnprovedError(
        `connection ${connectionId}: no domain is proved`,
      );
    }
    const testSignIn = await this.deps.testSignIns.findLatestForConnection({
      organizationId,
      connectionId,
    });
    if (testSignIn === null) {
      throw new SsoActivationTestSignInMissingError(
        `connection ${connectionId}: nobody has signed in through it`,
      );
    }
    if ((await this.liveBindings({ organizationId })).length === 0) {
      throw new SsoActivationBreakGlassMissingError(
        `organization ${organizationId}: no live way in without the identity provider`,
      );
    }
    // THE QUESTION THAT USED NOT TO BE ASKED. Turning a connection on without
    // saying what it does with somebody it has never seen is choosing by not
    // choosing, and the choice that got made by default — turn them away, and
    // hand them a workspace of their own — is the one nobody would pick.
    if (state.arrivalPolicyDecidedAtMs === null) {
      throw new SsoActivationArrivalsUndecidedError(
        `connection ${connectionId}: nobody has said who it admits`,
      );
    }

    await this.deps.connections().activateConnection({
      ...this.command({ organizationId, connectionId, actor }),
      // The account the round trip actually left behind, never a value the
      // surface chose: what the ledger records is the sign-in that happened.
      testLoginAccountId: testSignIn.accountId,
    });
    return { alreadyLive: false };
  }

  /**
   * Who this connection admits (ADR-117 §3).
   *
   * ASKED AFTER THE PROOF, never at registration: "anybody on a domain you
   * proved" is not an answer anybody can give before there is one, and an
   * organization revisits the decision without re-registering anything. The
   * guard holds the states it may be commanded from.
   *
   * Restating the policy already in force costs no event, so a screen that
   * saves without changing anything writes no history.
   */
  async setArrivals({
    organizationId,
    connectionId,
    policy,
    actor,
  }: {
    organizationId: string;
    connectionId: string;
    policy: SsoArrivalPolicy;
    actor: SelfServeActor;
  }): Promise<void> {
    await this.requireAvailable({ organizationId });
    const state = await this.requireOrganizationConnection({
      organizationId,
      connectionId,
    });
    await this.deps.connections().setArrivalPolicy({
      ...this.command({ organizationId, connectionId, actor }),
      policy,
    });
  }

  /**
   * Every way back in this organization has held, with who holds it.
   *
   * NOT gated on availability, and deliberately so. Registering a provider
   * and going live take a plan and an opt-in; a way back in takes neither,
   * because a lapsed subscription must never be the reason an organization
   * cannot reach its own recovery path. The same reasoning is why the grant
   * and renew surfaces are not plan-gated either.
   */
  async breakGlassHistory({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<SelfServeBreakGlassBindingView[]> {
    const bindings = await this.deps.breakGlass.history({ organizationId });
    const people = await this.peopleFor({ organizationId, bindings });
    const nowMs = this.now();
    return bindings.map((binding) => ({
      bindingId: binding.bindingId,
      userId: binding.userId,
      name: people.get(binding.userId)?.name ?? null,
      email: people.get(binding.userId)?.email ?? null,
      grantedByUserId: binding.grantedByUserId,
      grantedByName: people.get(binding.grantedByUserId)?.name ?? null,
      grantedAtMs: binding.grantedAtMs,
      expiresAtMs: binding.expiresAtMs,
      supersededAtMs: binding.supersededAtMs,
      live: breakGlassIsLive({ binding, nowMs }),
      daysRemaining: breakGlassDaysRemaining({ binding, nowMs }),
    }));
  }

  /** Who a way back in can be granted to: the organization's administrators,
   *  because the grant is a decision of the same weight as being one. */
  async breakGlassCandidates({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<SsoOrganizationMember[]> {
    return this.deps.members.findAdministrators({ organizationId });
  }

  private async liveBindings({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<BreakGlassBinding[]> {
    const nowMs = this.now();
    const bindings = await this.deps.breakGlass.history({ organizationId });
    return bindings.filter((binding) => breakGlassIsLive({ binding, nowMs }));
  }

  private async peopleFor({
    organizationId,
    bindings,
  }: {
    organizationId: string;
    bindings: BreakGlassBinding[];
  }): Promise<Map<string, SsoOrganizationMember>> {
    const userIds = [
      ...new Set(
        bindings.flatMap((binding) => [
          binding.userId,
          binding.grantedByUserId,
        ]),
      ),
    ];
    if (userIds.length === 0) return new Map();
    const people = await this.deps.members.findByIds({
      organizationId,
      userIds,
    });
    return new Map(people.map((person) => [person.userId, person]));
  }

  /**
   * Register the organization's identity provider (D09).
   *
   * SAML is no longer refused by name. D05 refused it on both surfaces
   * because nothing in the product could terminate it; something can now, so
   * the refusal is deleted rather than moved.
   *
   * Three steps, in this order and for this reason:
   *
   *   1. CHECK. Reaching the issuer and reading the metadata happen here,
   *      where a refusal can reach the person who typed the address. Neither
   *      may happen in the fold — a projection that made a network call would
   *      rebuild differently on every replay.
   *   2. KEEP. The values go in the vault and answer references. This is what
   *      `clientIdRef` / `secretRef` / `certRefs` have always pointed at and
   *      what, until now, was not there.
   *   3. STATE. One command, carrying the references and no value.
   *
   * Nothing here writes the engine's provider row. That is folded from the
   * fact this command produces, which is what makes the engine's table a
   * projection of the log rather than a second thing to keep in step.
   */
  async registerConnection({
    organizationId,
    providerId,
    idp,
    actor,
  }: {
    organizationId: string;
    /** What the customer calls their provider. Shown back to them, and never
     *  what the engine is keyed by — that is the connection id, so two
     *  organizations may both say `okta`. */
    providerId: string;
    idp: SsoIdpRegistration;
    actor: SelfServeActor;
  }): Promise<{ connectionId: string }> {
    await this.requireAvailable({ organizationId });
    // One connection per organization, and it is an abuse rail as much as a
    // journey rule. The claim rate limit counts a CONNECTION's own claims, so
    // an unbounded register would let somebody spend five domain claims an
    // hour per registration and enumerate at whatever rate they cared to.
    // Read from the ledger's own projection rather than a counter, so a
    // discarded or torn-down connection correctly stops being one.
    const held = await this.deps.reads.findConnectionForOrganization({
      organizationId,
    });
    if (held !== null) {
      throw new SsoConnectionAlreadyRegisteredError(
        `organization ${organizationId} already holds connection ${held.connectionId} in ${held.state}`,
      );
    }
    const connectionId = newSsoConnectionId();
    const credentials = this.deps.credentials;

    if (idp.protocol === "oidc") {
      await validateOidcRegistration({
        registration: idp,
        discovery: this.deps.discovery,
      });
      const [clientIdRef, secretRef] = await Promise.all([
        credentials.put({
          organizationId,
          connectionId,
          kind: "oidc-client-id",
          value: idp.clientId,
        }),
        credentials.put({
          organizationId,
          connectionId,
          kind: "oidc-client-secret",
          value: idp.clientSecret,
        }),
      ]);
      await this.deps.connections().registerConnection({
        ...this.command({ organizationId, connectionId, actor }),
        type: "oidc",
        idp: {
          issuer: idp.issuer,
          providerId,
          clientIdRef,
          secretRef,
          certRefs: [],
        },
        arrivalPolicy: DEFAULT_SSO_ARRIVAL_POLICY,
      });
      return { connectionId };
    }

    const config = validateSamlRegistration(idp);
    const certRef = await credentials.put({
      organizationId,
      connectionId,
      kind: "saml-idp-config",
      value: JSON.stringify(config),
    });
    await this.deps.connections().registerConnection({
      ...this.command({ organizationId, connectionId, actor }),
      type: "saml",
      idp: {
        // The identity provider's entity id is what a SAML connection has
        // instead of an issuer address, and it is the same thing: the name
        // the other side signs its assertions as.
        issuer: config.entityId,
        providerId,
        clientIdRef: null,
        secretRef: null,
        certRefs: [certRef],
      },
      arrivalPolicy: DEFAULT_SSO_ARRIVAL_POLICY,
    });
    return { connectionId };
  }

  /**
   * Claim a domain — and, where the licence is the authorization, approve it
   * in the same step.
   *
   * The two-command shape is the point rather than an inefficiency: the
   * claim and the decision are separate facts on every tier, so a
   * licence-authorized connection's history reads exactly like one a record
   * decided except for the one word that says who decided.
   *
   * On the published-record tier NOTHING is approved here, and that absence
   * is the design: the record is the decision, so the claim stays waiting
   * until the record lands and the guard states both facts together. What
   * this answers is only whether a person is now involved — which is true of
   * exactly one claim, the one on a domain another organization has already
   * proved.
   */
  async claimDomain({
    organizationId,
    connectionId,
    domain,
    actor,
  }: {
    organizationId: string;
    connectionId: string;
    domain: string;
    actor: SelfServeActor;
  }): Promise<{ waitsForReview: boolean; disputed: boolean }> {
    const availability = await this.requireAvailable({ organizationId });
    // Resolved before the command so a foreign connection answers the same
    // sentence every other verb answers. The guard refuses it independently —
    // that is the rail, and it is what caught this verb — but it refuses with
    // a transition code, and "whose connection is this" is not a question
    // about transitions. One refusal, one code, from the surface a customer
    // is actually holding.
    await this.requireOrganizationConnection({ organizationId, connectionId });
    await this.deps.connections().claimDomain({
      ...this.command({ organizationId, connectionId, actor }),
      domain,
    });
    if (availability.proof === "license-token") {
      await this.deps.connections().approveDomainClaim({
        ...this.command({ organizationId, connectionId, actor }),
        domain,
        authority: "license",
      });
      return { waitsForReview: false, disputed: false };
    }
    const disputed = await this.isDisputed({ organizationId, domain });
    return { waitsForReview: disputed, disputed };
  }

  /**
   * Ask to prove a domain.
   *
   * On a licensed installation this finishes: the licence is the proof, so
   * the ceremony opens and closes in one call and the administrator never
   * leaves the page. On the hosted service it issues the record to publish,
   * and returns its value ONCE — the fact carries only the hash, so a
   * customer who loses the value asks for a fresh record rather than reading
   * an old one back out of us.
   */
  async proveDomain({
    organizationId,
    connectionId,
    domain,
    actor,
  }: {
    organizationId: string;
    connectionId: string;
    domain: string;
    actor: SelfServeActor;
  }): Promise<
    { proved: true } | { proved: false; record: SelfServeIssuedDnsRecord }
  > {
    const availability = await this.requireAvailable({ organizationId });
    await this.requireClaimProvable({ organizationId, connectionId, domain });

    if (availability.proof === "license-token") {
      const licenseKey = await this.deps.license.currentLicenseKey();
      if (!licenseKey) {
        throw new SsoLicenseRequiredError(
          `organization ${organizationId}: the installation holds no licence to prove ${domain} with`,
        );
      }
      // The licence key itself is never recorded. What the fact carries is a
      // hash of it, exactly as the published-record ceremony carries a hash
      // of a token nobody ever sees again.
      await this.deps.connections().requestVerification({
        ...this.command({ organizationId, connectionId, actor }),
        domain,
        method: "license-token",
        tokenHash: `sha256:${sha256Hex(licenseKey)}`,
        // A licence-bound proof does not expire: the licence is checked
        // afresh at every startup, so a deadline here would be a second,
        // worse copy of that check.
        expiresAtMs: null,
      });
      await this.deps.connections().verifyDomain({
        ...this.command({ organizationId, connectionId, actor }),
        domain,
      });
      return { proved: true };
    }

    const value = mintVerificationToken();
    const expiresAtMs = this.now() + SSO_DNS_PROOF_TTL_MS;
    await this.deps.connections().requestVerification({
      ...this.command({ organizationId, connectionId, actor }),
      domain,
      method: "dns-txt",
      tokenHash: `sha256:${sha256Hex(value)}`,
      expiresAtMs,
    });
    // The location is answered against the NORMALIZED domain, because that
    // is the name the lookup will ask for: telling a customer to publish at
    // `_langwatch-verification.ACME.com` and then reading a different name
    // is a ceremony that can never finish.
    return {
      proved: false,
      record: {
        ...recordLocationFor({ domain: normalizeDomain(domain) }),
        value,
        expiresAtMs,
      },
    };
  }

  /**
   * Look for the record on the domain.
   *
   * Three answers, because the world has three (D05 tier 3): the record is
   * there, the record is not there yet, or we could not find out. The middle
   * one is a refusal by name so the customer is told plainly — and the record
   * they were given is left exactly as it was, because a missing record is a
   * DNS change that has not propagated rather than a ceremony that went
   * wrong. The third is a DIFFERENT refusal, because "publish it and check
   * again" is the wrong instruction for a resolver that could not answer.
   *
   * The lookup runs BEFORE the command, always. Nothing here can state a
   * verified fact on a domain whose record was not read: a failed or absent
   * lookup returns without the aggregate ever being commanded, so the ledger
   * carries no trace of an attempt that proved nothing.
   */
  async checkDomainRecord({
    organizationId,
    connectionId,
    domain,
    actor,
  }: {
    organizationId: string;
    connectionId: string;
    domain: string;
    actor: SelfServeActor;
  }): Promise<{ proved: true }> {
    await this.requireAvailable({ organizationId });
    const state = await this.requireOrganizationConnection({
      organizationId,
      connectionId,
    });
    const normalized = normalizeDomain(domain);
    const pending = state.pendingVerification;
    if (!pending || pending.domain !== normalized) {
      throw new SsoDomainProofNotFoundError(
        `connection ${connectionId}: no record is outstanding for ${normalized}`,
      );
    }
    const name = ssoDnsRecordName({ domain: normalized });
    const lookup = await this.deps.proofs.lookupTxtValues({
      domain: normalized,
      name,
    });
    // A resolver that could not answer has told us nothing about the domain,
    // so this is not a verification failure and is not reported as one. The
    // ceremony is untouched and the same button works a minute later.
    if (lookup.outcome === "unreachable") {
      throw new SsoDomainLookupFailedError(
        `connection ${connectionId}: ${name} could not be resolved (${lookup.reason})`,
      );
    }
    const published = lookup.outcome === "published" ? lookup.values : [];
    // A constant-time comparison, for the same reason the email ceremony
    // next door uses one: the published value is public, but the token we
    // minted is not until somebody publishes it, and a comparison that
    // leaks how far it matched is a comparison worth not writing.
    const matched = published.some((value) =>
      safeEqual(`sha256:${sha256Hex(value.trim())}`, pending.tokenHash),
    );
    if (!matched) {
      throw new SsoDomainProofNotFoundError(
        `connection ${connectionId}: no matching record is published at ${name}`,
      );
    }
    // The guard decides whether a found record still proves anything: an
    // expired one does not, and refusing there rather than here keeps the
    // rule in the one place every caller passes through.
    await this.deps.connections().verifyDomain({
      ...this.command({ organizationId, connectionId, actor }),
      domain: normalized,
      channel: "dns-txt",
    });
    return { proved: true };
  }

  /**
   * Look for the file on the domain — the same ceremony's other channel.
   *
   * The one outstanding token satisfies either way: as the record above, or
   * as the body of a file the domain serves at the well-known path. Serving
   * it demonstrates the same thing publishing it does — control of the
   * domain — so a match runs the same guard with the channel named, and the
   * verified fact records where the evidence actually lives. That is what
   * lets the re-proof sweep re-read a file-proved domain's file rather than
   * hunting for a record nobody published.
   *
   * The three answers mirror the record check's, code for code: found is a
   * proof, a clean not-found is the customer's next step said in file words,
   * and a fetch that failed is not a verification failure at all — the
   * ceremony is untouched and the same button works a minute later.
   */
  async checkDomainFile({
    organizationId,
    connectionId,
    domain,
    actor,
  }: {
    organizationId: string;
    connectionId: string;
    domain: string;
    actor: SelfServeActor;
  }): Promise<{ proved: true }> {
    await this.requireAvailable({ organizationId });
    const state = await this.requireOrganizationConnection({
      organizationId,
      connectionId,
    });
    const normalized = normalizeDomain(domain);
    const pending = state.pendingVerification;
    if (!pending || pending.domain !== normalized) {
      throw new SsoDomainProofNotFoundError(
        `connection ${connectionId}: no record is outstanding for ${normalized}`,
      );
    }
    const url = ssoVerificationFileUrl({ domain: normalized });
    const fetched = await this.deps.files.fetchVerificationFile({
      domain: normalized,
      url,
    });
    if (fetched.outcome === "unreachable") {
      throw new SsoDomainFetchFailedError(
        `connection ${connectionId}: ${url} could not be fetched (${fetched.reason})`,
      );
    }
    const served = fetched.outcome === "served" ? fetched.values : [];
    const matched = served.some((value) =>
      safeEqual(`sha256:${sha256Hex(value.trim())}`, pending.tokenHash),
    );
    if (!matched) {
      throw new SsoDomainFileNotFoundError(
        `connection ${connectionId}: no matching file is served at ${url}`,
      );
    }
    await this.deps.connections().verifyDomain({
      ...this.command({ organizationId, connectionId, actor }),
      domain: normalized,
      channel: "https-file",
    });
    return { proved: true };
  }

  /**
   * Setup is available, or the reader is told what would change that. The
   * three refusals are the three honest answers: activate a licence, restart
   * for the licence you activated, or talk to us.
   */
  private async requireAvailable({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<Extract<SsoSelfServeAvailability, { available: true }>> {
    const availability = ssoSelfServeAvailability(
      await this.deps.context.resolve({ organizationId }),
    );
    if (availability.available) return availability;
    if (availability.refusal === "not_opted_in") {
      throw new SsoSelfServeUnavailableError(
        `organization ${organizationId} is not opted in to self-serve single sign-on setup`,
      );
    }
    throw new SsoLicenseRequiredError(
      availability.refusal === "license_restart_required"
        ? `organization ${organizationId}: a licence was activated after this process started`
        : `organization ${organizationId}: the installation holds no genuine licence`,
    );
  }

  /**
   * Whether a record may be asked for on this domain yet.
   *
   * A waiting claim is no longer a reason to refuse — it is the ordinary
   * state of a claim whose record has not been published, and the record is
   * what will decide it. The one waiting claim that IS refused is the
   * disputed one: another organization has already proved the domain, so the
   * customer would publish a record and be turned away at the check, which
   * is exactly the wasted ticket with a DNS team this refusal exists to
   * prevent.
   *
   * The guards refuse the same thing independently and in stronger terms —
   * `sso_connection_domain_taken`, on ownership rather than on courtesy — so
   * a caller that finds the command another way is stopped there.
   */
  private async requireClaimProvable({
    organizationId,
    connectionId,
    domain,
  }: {
    organizationId: string;
    connectionId: string;
    domain: string;
  }): Promise<void> {
    const state = await this.requireOrganizationConnection({
      organizationId,
      connectionId,
    });
    const claim = domainClaimFor({
      state,
      domain: normalizeDomain(domain),
    });
    if (claim?.state !== "WAITING") return;
    if (!(await this.isDisputed({ organizationId, domain }))) return;
    throw new SsoDomainClaimPendingError(
      `connection ${connectionId}: the claim on ${domain} has not been decided`,
    );
  }

  /**
   * Whether some OTHER organization already holds this domain.
   *
   * Asked of the same read the guards ask, deliberately: "who owns this
   * domain" has to have one answer, or the surface would route a claim to a
   * person that the guard then waves through, or the reverse. The scope of
   * "already" is the read's — global on the hosted service, this
   * installation on a self-hosted one — and this is not the place to
   * re-decide it.
   */
  private async isDisputed({
    organizationId,
    domain,
  }: {
    organizationId: string;
    domain: string;
  }): Promise<boolean> {
    const owner = await this.deps.reads.findDomainOwner({
      domain: normalizeDomain(domain),
    });
    return owner !== null && owner.organizationId !== organizationId;
  }

  /**
   * Undo a registration that never went live: back to the empty journey,
   * with the history keeping what was tried. The guards refuse this for an
   * ACTIVE connection — a connection deciding sign-in is removed through
   * {@link removeConnection}, which is graced and reversible, never through
   * a discard.
   */
  async discardConnection({
    organizationId,
    connectionId,
    actor,
  }: {
    organizationId: string;
    connectionId: string;
    actor: SelfServeActor;
  }): Promise<void> {
    await this.requireOrganizationConnection({ organizationId, connectionId });
    await this.deps
      .connections()
      .discardConnection(this.command({ organizationId, connectionId, actor }));
  }

  /**
   * Remove a live connection. The grace exists for the people signing in
   * through it: sign-in keeps working while the removal is scheduled, and
   * the schedule is visible and reversible until it completes. The guards
   * refuse it while anybody would be stranded without another way in.
   *
   * A connection the organization is NOT routing off strands nobody, so its
   * removal owes nobody a grace: the deadline is now, and the teardown wake
   * completes it immediately. This is also how a scheduled removal is
   * brought forward — asking again re-derives the deadline (the guards
   * accept a re-ask from TEARDOWN_PENDING), so an organization that turned
   * routing off does not wait out a week that protects nobody.
   */
  async removeConnection({
    organizationId,
    connectionId,
    actor,
    reason,
    graceMs,
  }: {
    organizationId: string;
    connectionId: string;
    actor: SelfServeActor;
    reason: string | null;
    graceMs: number;
  }): Promise<void> {
    const connection = await this.requireOrganizationConnection({
      organizationId,
      connectionId,
    });
    // The grace exists to protect people who are being SENT to this
    // connection. One that was never turned on carried nobody, so waiting out
    // a week would protect nobody and only delay the tidying.
    await this.deps.connections().requestTeardown({
      ...this.command({ organizationId, connectionId, actor }),
      reason,
      graceMs: connection.state === "ACTIVE" ? graceMs : 0,
    });
  }

  /**
   * Take a domain back out — a mistyped claim, a domain the company let go,
   * a verification nobody wants any more. The guards refuse removing a
   * VERIFIED domain from a connection that is deciding sign-in; everything
   * else is the administrator's to tidy.
   */
  async removeDomain({
    organizationId,
    connectionId,
    domain,
    actor,
  }: {
    organizationId: string;
    connectionId: string;
    domain: string;
    actor: SelfServeActor;
  }): Promise<void> {
    await this.requireOrganizationConnection({ organizationId, connectionId });
    await this.deps.connections().withdrawDomain({
      ...this.command({ organizationId, connectionId, actor }),
      domain,
    });
  }

  /**
   * The connection, and proof it is this organization's.
   *
   * There is deliberately NO organization-blind sibling to this method. There
   * was one, and five verbs reached for it because it was the shorter call —
   * `connectionId` is caller input on every self-serve surface and the tRPC
   * permission is checked against the caller's own `organizationId`, so those
   * five let an administrator of one organization drive another's connection.
   * The fix is not to add the check five more times; it is that the only way
   * to resolve a connection here requires naming who is asking.
   *
   * Both misses answer the same sentence. "Not yours" and "not there" must be
   * indistinguishable, or the refusal is an existence oracle for connection
   * ids — which are not secret (the unauthenticated sign-in router returns one
   * for any domain that routes).
   */
  private async requireOrganizationConnection({
    organizationId,
    connectionId,
  }: {
    organizationId: string;
    connectionId: string;
  }): Promise<SsoConnectionState> {
    const state = await this.deps.reads.findConnection({ connectionId });
    if (!state || state.organizationId !== organizationId) {
      throw new SsoDomainProofNotFoundError(
        `connection ${connectionId} does not exist`,
      );
    }
    return state;
  }

  /**
   * The identity block every command carries. Minted here so no caller can
   * supply an actor: the administrator the surface authenticated is the
   * actor, and the history says so.
   */
  private command({
    organizationId,
    connectionId,
    actor,
  }: {
    organizationId: string;
    connectionId: string;
    actor: SelfServeActor;
  }) {
    return {
      tenantId: organizationId,
      organizationId,
      connectionId,
      commandId: newSsoConnectionCommandId(),
      occurredAtMs: this.now(),
      actor: { type: "user" as const, id: actor.userId },
      source: "self-serve" as const,
    };
  }
}

/**
 * Where the record goes, in one place. Composed from the identity
 * vocabulary rather than spelled out, so the name shown to a customer, the
 * name the lookup asks for and the name a refusal quotes cannot drift apart
 * — a ceremony where those three disagree is one nobody can ever finish.
 */
function recordLocationFor({
  domain,
}: {
  domain: string;
}): SelfServeDnsRecordLocation {
  return {
    domain,
    label: SSO_DNS_RECORD_NAME,
    name: ssoDnsRecordName({ domain }),
    type: SSO_DNS_RECORD_TYPE,
    file: {
      path: SSO_VERIFICATION_FILE_PATH,
      url: ssoVerificationFileUrl({ domain }),
    },
  };
}

function toClaimView(claim: SsoDomainClaim): SelfServeDomainClaimView {
  return {
    domain: claim.domain,
    state: claim.state,
    claimedAtMs: claim.claimedAtMs,
    decidedAtMs: claim.decidedAtMs,
    waitedMs: claim.waitedMs,
    note: claim.note,
    // Overwritten by the caller, which is the only place that can ask
    // another organization's domains about it.
    waitsForReview: false,
  };
}
