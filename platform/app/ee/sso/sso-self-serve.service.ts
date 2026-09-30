// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import {
  type BreakGlassBinding,
  breakGlassDaysRemaining,
  breakGlassIsLive,
  DEFAULT_SSO_ARRIVAL_POLICY,
  domainClaimFor,
  normalizeDomain,
  qualifySsoDomainOwnership,
  SSO_DNS_PROOF_TTL_MS,
  SSO_DNS_RECORD_NAME,
  SSO_DNS_RECORD_TYPE,
  SSO_VERIFICATION_FILE_PATH,
  SsoActivationArrivalsUndecidedError,
  SsoActivationBreakGlassMissingError,
  SsoActivationDomainUnprovedError,
  SsoActivationTestSignInMissingError,
  type SsoArrivalPolicy,
  SsoConnectionAlreadyRegisteredError,
  SsoConnectionNotFoundError,
  type SsoConnectionState,
  type SsoDomainClaim,
  SsoDomainClaimPendingError,
  SsoDomainFetchFailedError,
  SsoDomainFileNotFoundError,
  SsoDomainLookupFailedError,
  SsoDomainProofNotFoundError,
  SsoLicenseRequiredError,
  type SsoMigrationRoute,
  type SsoSelfServeAvailability,
  type SsoSelfServeContext,
  SsoSelfServeUnavailableError,
  ssoArrivalPolicy,
  ssoDnsRecordName,
  ssoSelfServeAvailability,
  ssoVerificationFileUrl,
  verificationHasExpired,
} from "@langwatch/identity";
import {
  mintVerificationToken,
  safeEqual,
  sha256Hex,
} from "@langwatch/identity-server";
import type { SsoConnectionReadRepository } from "./sso-connection.repository";
import type { SsoConnectionService } from "./sso-connection.service";
import type { LegacySsoOrganizationRepository } from "./sso-connection-grandfather.service";
import {
  legacyReplacementCommandId,
  legacyReplacementConnectionId,
  newSsoConnectionCommandId,
  selfServeRegistrationCommandId,
  selfServeRegistrationConnectionId,
} from "./sso-connection-id";
import type { SsoCredentialStore } from "./sso-credential-store";
import { serviceProviderDetailsFor } from "./sso-engine-provider";
import {
  type SsoIdpRegistration,
  type SsoIssuerDiscoveryPort,
  validateOidcRegistration,
  validateSamlRegistration,
} from "./sso-idp-registration";
import type { SsoMigrationFinalizationService } from "./sso-migration-finalization.service";
import type {
  SelfServeBreakGlassBindingView,
  SelfServeDnsRecordLocation,
  SelfServeDomainClaimView,
  SelfServeGoLiveView,
  SelfServeIssuedDnsRecord,
  SelfServeMigrationView,
  SelfServeSetupView,
} from "./sso-self-serve.types";

/** The states `activate_connection` accepts. Stated here so the checklist and
 *  the guard cannot drift into disagreeing about whether the button works. */
const ACTIVATABLE_STATES: readonly string[] = ["VERIFIED"];

/**
 * Self-serve commands pass through the aggregate's guarded lifecycle.
 * Every deployment requires published domain proof; only operators attest domains.
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

interface DomainProofCommand {
  organizationId: string;
  connectionId: string;
  domain: string;
  actor: SelfServeActor;
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
  /**
   * Whether this person holds a password, and so could actually walk through
   * a way back in if they were granted one.
   *
   * On the list rather than filtered out of it: an administrator choosing who
   * keeps a door needs to see that their first choice cannot hold it yet, and
   * why — a name silently missing from a picker teaches nobody anything. The
   * grant itself refuses, which is where the promise is kept.
   */
  holdsPassword: boolean;
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

/** Operational reads for the migration pair. */
export interface SsoMigrationProgressReadPort {
  getProgress(args: {
    organizationId: string;
    connectionId?: string;
    cursor: string | null;
    limit: number;
  }): Promise<SelfServeMigrationView | null>;
}

export interface SsoSelfServeServiceDeps {
  connections: () => SsoConnectionService;
  reads: SsoConnectionReadRepository;
  /** The pre-connection sign-in strings, so the screen can tell an
   *  organization that already has a route from one that has none. */
  legacy: LegacySsoOrganizationRepository;
  context: SsoSelfServeContextPort;
  proofs: SsoDomainProofLookup;
  /** The published proof's second channel: the file the domain serves. */
  files: SsoDomainFileLookup;
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
  migrations: SsoMigrationProgressReadPort;
  finalization: SsoMigrationFinalizationService;
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
    const { migration, state, legacy } = await this.setupState({
      organizationId,
    });
    const nowMs = this.now();
    return {
      availability,
      serviceProvider: serviceProviderDetailsFor({
        baseUrl: this.deps.baseUrl,
        connectionId: state?.connectionId ?? null,
      }),
      serviceProviderBeforeRegistration: serviceProviderDetailsFor({
        baseUrl: this.deps.baseUrl,
        connectionId: null,
      }),
      connection: toConnectionView(state),
      legacyRoute: legacy
        ? { domain: legacy.ssoDomain, provider: legacy.ssoProvider }
        : null,
      claims: await this.claimViews({ organizationId, state }),
      record: toRecordView({ state, nowMs }),
      goLive: state
        ? await this.goLiveFor({ organizationId, connection: state })
        : null,
      migration,
      attestationOffered: false,
    };
  }

  private async setupState({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<{
    migration: SelfServeMigrationView | null;
    state: SsoConnectionState | null;
    legacy: { ssoDomain: string; ssoProvider: string } | null;
  }> {
    const migration = await this.deps.migrations.getProgress({
      organizationId,
      cursor: null,
      limit: 25,
    });
    const state = migration
      ? await this.requireOrganizationConnection({
          organizationId,
          connectionId: migration.replacement.connectionId,
        })
      : await this.deps.reads.findConnectionForOrganization({ organizationId });
    const legacy = state
      ? null
      : await this.deps.legacy.findLegacySso({ organizationId });
    return { migration, state, legacy };
  }

  private async claimViews({
    organizationId,
    state,
  }: {
    organizationId: string;
    state: SsoConnectionState | null;
  }): Promise<SelfServeSetupView["claims"]> {
    return Promise.all(
      (state?.domainClaims ?? [])
        .filter(
          (
            claim,
          ): claim is SsoDomainClaim & {
            state: Exclude<SsoDomainClaim["state"], "WITHDRAWN">;
          } => claim.state !== "WITHDRAWN",
        )
        .map(async (claim) => ({
          ...toClaimView(claim),
          waitsForReview:
            claim.state === "WAITING" &&
            (await this.isDisputed({ organizationId, domain: claim.domain })),
        })),
    );
  }

  async getMigrationProgress({
    organizationId,
    connectionId,
    cursor,
    limit,
  }: {
    organizationId: string;
    connectionId: string;
    cursor: string | null;
    limit: number;
  }): Promise<SelfServeMigrationView | null> {
    await this.requireOrganizationConnection({ organizationId, connectionId });
    return await this.deps.migrations.getProgress({
      organizationId,
      connectionId,
      cursor,
      limit,
    });
  }

  /** Reads the same proof sources activation checks. */
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
    const domainProved = connection.verifiedDomains.some(
      (domain) =>
        qualifySsoDomainOwnership({ state: connection, domain }).status ===
        "QUALIFIED",
    );
    // The default policy is not an explicit administrator decision.
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
      // Proof alone cannot make a lifecycle transition legal.
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
   * Checks preconditions in screen order for actionable errors; the aggregate
   * rechecks them for every caller. Repeating a completed activation is a no-op.
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

    const domainProved = state.verifiedDomains.some(
      (domain) =>
        qualifySsoDomainOwnership({ state, domain }).status === "QUALIFIED",
    );
    if (!domainProved) {
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

  /** Arrival policy is chosen after proof. Restating it writes no event (ADR-117). */
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
    await this.requireOrganizationConnection({
      organizationId,
      connectionId,
    });
    await this.deps.connections().setArrivalPolicy({
      ...this.command({ organizationId, connectionId, actor }),
      policy,
    });
  }

  /**
   * The word on the card.
   *
   * Availability is NOT required, unlike every other change here. Renaming
   * decides nothing about who gets in, and an organization whose plan lapsed
   * still reads these cards — leaving them looking at a name they cannot
   * correct would be a refusal that protects nothing.
   */
  async rename({
    organizationId,
    connectionId,
    name,
    actor,
  }: {
    organizationId: string;
    connectionId: string;
    name: string;
    actor: SelfServeActor;
  }): Promise<void> {
    await this.requireOrganizationConnection({ organizationId, connectionId });
    await this.deps.connections().renameConnection({
      ...this.command({ organizationId, connectionId, actor }),
      name,
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
    const connectionId = await this.nextSelfServeRegistrationAttempt({
      organizationId,
      actorUserId: actor.userId,
    });
    const registration = await this.prepareRegistration({
      organizationId,
      connectionId,
      providerId,
      idp,
    });
    await this.deps.connections().registerConnection({
      ...this.command({
        organizationId,
        connectionId,
        actor,
        commandId: selfServeRegistrationCommandId({
          organizationId,
          connectionId,
          actorUserId: actor.userId,
        }),
      }),
      ...registration,
      arrivalPolicy: DEFAULT_SSO_ARRIVAL_POLICY,
    });
    return { connectionId };
  }

  private async nextSelfServeRegistrationAttempt({
    organizationId,
    actorUserId,
  }: {
    organizationId: string;
    actorUserId: string;
  }): Promise<string> {
    let previousTerminal:
      | { connectionId: string; updatedAtMs: number }
      | undefined;
    while (true) {
      const connectionId = selfServeRegistrationConnectionId({
        organizationId,
        actorUserId,
        previousTerminal,
      });
      const existing = await this.deps.reads.findConnection({ connectionId });
      if (existing === null) return connectionId;
      if (
        existing.organizationId !== organizationId ||
        existing.source !== "self-serve" ||
        existing.replacesConnectionId !== null
      ) {
        throw new SsoConnectionAlreadyRegisteredError(
          `registration id ${connectionId} is held by another connection`,
        );
      }
      if (existing.state !== "DISCARDED" && existing.state !== "TORN_DOWN") {
        return connectionId;
      }
      previousTerminal = {
        connectionId,
        updatedAtMs: existing.updatedAtMs,
      };
    }
  }

  /**
   * Start the one supported coexistence case: a direct provider replacing the
   * organization's grandfathered provider. The replacement relation is part
   * of the registration command, so concurrent attempts contend on the same
   * database-enforced slot rather than both passing a preliminary count.
   */
  async startLegacyMigration({
    organizationId,
    legacyConnectionId,
    providerId,
    idp,
    actor,
  }: {
    organizationId: string;
    legacyConnectionId: string;
    providerId: string;
    idp: SsoIdpRegistration;
    actor: SelfServeActor;
  }): Promise<{ connectionId: string }> {
    await this.requireAvailable({ organizationId });
    const legacy = await this.requireOrganizationConnection({
      organizationId,
      connectionId: legacyConnectionId,
    });
    if (legacy.source !== "legacy-grandfathered") {
      throw new SsoConnectionAlreadyRegisteredError(
        `connection ${legacyConnectionId} is not a grandfathered provider`,
      );
    }

    const attempt = await this.nextLegacyReplacementAttempt({
      organizationId,
      legacyConnectionId,
    });
    const connectionId = attempt.connectionId;
    if (attempt.alreadyRegistered) return { connectionId };
    const registration = await this.prepareRegistration({
      organizationId,
      connectionId,
      providerId,
      idp,
    });
    await this.deps.connections().registerReplacementConnection({
      ...this.command({
        organizationId,
        connectionId,
        actor,
        commandId: legacyReplacementCommandId({
          organizationId,
          legacyConnectionId,
          replacementConnectionId: connectionId,
        }),
      }),
      ...registration,
      arrivalPolicy: DEFAULT_SSO_ARRIVAL_POLICY,
      replacesConnectionId: legacyConnectionId,
    });
    const projected = await this.deps.reads.findConnection({ connectionId });
    if (
      projected?.organizationId !== organizationId ||
      projected.replacesConnectionId !== legacyConnectionId ||
      projected.source !== "self-serve" ||
      projected.migrationPhase === null
    ) {
      throw new SsoConnectionNotFoundError(
        `replacement ${connectionId} was not visible after registration`,
      );
    }
    return { connectionId };
  }

  private async nextLegacyReplacementAttempt({
    organizationId,
    legacyConnectionId,
  }: {
    organizationId: string;
    legacyConnectionId: string;
  }): Promise<{ connectionId: string; alreadyRegistered: boolean }> {
    let previousTerminal:
      | { connectionId: string; updatedAtMs: number }
      | undefined;
    while (true) {
      const connectionId = legacyReplacementConnectionId({
        organizationId,
        legacyConnectionId,
        previousTerminal,
      });
      const existing = await this.deps.reads.findConnection({ connectionId });
      if (existing === null) return { connectionId, alreadyRegistered: false };
      if (
        existing.organizationId !== organizationId ||
        existing.replacesConnectionId !== legacyConnectionId ||
        existing.source !== "self-serve"
      ) {
        throw new SsoConnectionAlreadyRegisteredError(
          `replacement id ${connectionId} is held by another connection`,
        );
      }
      if (existing.state !== "DISCARDED" && existing.state !== "TORN_DOWN") {
        return { connectionId, alreadyRegistered: true };
      }
      previousTerminal = {
        connectionId,
        updatedAtMs: existing.updatedAtMs,
      };
    }
  }

  async selectMigrationRoute({
    organizationId,
    connectionId,
    route,
    actor,
  }: {
    organizationId: string;
    connectionId: string;
    route: SsoMigrationRoute;
    actor: SelfServeActor;
  }): Promise<void> {
    await this.requireOrganizationConnection({ organizationId, connectionId });
    await this.deps.connections().selectMigrationRoute({
      ...this.command({ organizationId, connectionId, actor }),
      route,
    });
  }

  async finalizeLegacyMigration({
    organizationId,
    connectionId,
    actor,
  }: {
    organizationId: string;
    connectionId: string;
    actor: SelfServeActor;
  }): Promise<void> {
    await this.requireAvailable({ organizationId });
    await this.requireOrganizationConnection({ organizationId, connectionId });
    await this.deps.finalization.finalize({
      organizationId,
      replacementConnectionId: connectionId,
      actorUserId: actor.userId,
    });
  }

  private async prepareRegistration({
    organizationId,
    connectionId,
    providerId,
    idp,
  }: {
    organizationId: string;
    connectionId: string;
    providerId: string;
    idp: SsoIdpRegistration;
  }) {
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
      return {
        type: "oidc",
        idp: {
          issuer: idp.issuer,
          providerId,
          clientIdRef,
          secretRef,
          certRefs: [] as string[],
        },
      } as const;
    }

    const config = validateSamlRegistration(idp);
    const certRef = await credentials.put({
      organizationId,
      connectionId,
      kind: "saml-idp-config",
      value: JSON.stringify(config),
    });
    return {
      type: "saml",
      idp: {
        // The identity provider's entity id is what a SAML connection has
        // instead of an issuer address, and it is the same thing: the name
        // the other side signs its assertions as.
        issuer: config.entityId,
        providerId,
        clientIdRef: null,
        secretRef: null,
        certRefs: [certRef] as string[],
      },
    } as const;
  }

  /** Records a claim; only published proof can verify it. */
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
    await this.requireAvailable({ organizationId });
    // Keep the surface's tenant refusal consistent; the aggregate also enforces it.
    await this.requireOrganizationConnection({ organizationId, connectionId });
    await this.deps.connections().claimDomain({
      ...this.command({ organizationId, connectionId, actor }),
      domain,
    });
    const disputed = await this.isDisputed({ organizationId, domain });
    return { waitsForReview: disputed, disputed };
  }

  /**
   * Ask to prove a domain.
   *
   * A licence makes the feature available; it is not evidence that the
   * organization controls a domain. Every self-serve installation therefore
   * issues the same record to publish,
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
    await this.requireAvailable({ organizationId });
    await this.requireClaimProvable({ organizationId, connectionId, domain });

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

  async checkDomainRecord(
    command: DomainProofCommand,
  ): Promise<{ proved: true }> {
    return this.#checkPublishedProof(command, "dns-txt");
  }

  async checkDomainFile(
    command: DomainProofCommand,
  ): Promise<{ proved: true }> {
    return this.#checkPublishedProof(command, "https-file");
  }

  async #checkPublishedProof(
    { organizationId, connectionId, domain, actor }: DomainProofCommand,
    channel: "dns-txt" | "https-file",
  ): Promise<{ proved: true }> {
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

    const { published, missingProof } = await this.publishedProofFor({
      connectionId,
      domain: normalized,
      channel,
    });

    // Neither a missing proof nor an unreachable publisher changes the ceremony.
    const matched = published.some((value) =>
      safeEqual(`sha256:${sha256Hex(value.trim())}`, pending.tokenHash),
    );
    if (!matched) throw missingProof;

    // The aggregate rechecks expiry and ownership before recording the proof.
    await this.deps.connections().verifyDomain({
      ...this.command({ organizationId, connectionId, actor }),
      domain: normalized,
      channel,
    });
    return { proved: true };
  }

  private async publishedProofFor({
    connectionId,
    domain,
    channel,
  }: {
    connectionId: string;
    domain: string;
    channel: "dns-txt" | "https-file";
  }): Promise<{ published: string[]; missingProof: Error }> {
    if (channel === "dns-txt") {
      const name = ssoDnsRecordName({ domain });
      const lookup = await this.deps.proofs.lookupTxtValues({
        domain,
        name,
      });
      if (lookup.outcome === "unreachable") {
        throw new SsoDomainLookupFailedError(
          `connection ${connectionId}: ${name} could not be resolved (${lookup.reason})`,
        );
      }
      return {
        published: lookup.outcome === "published" ? lookup.values : [],
        missingProof: new SsoDomainProofNotFoundError(
          `connection ${connectionId}: no matching record is published at ${name}`,
        ),
      };
    }

    const url = ssoVerificationFileUrl({ domain });
    const fetched = await this.deps.files.fetchVerificationFile({
      domain,
      url,
    });
    if (fetched.outcome === "unreachable") {
      throw new SsoDomainFetchFailedError(
        `connection ${connectionId}: ${url} could not be fetched (${fetched.reason})`,
      );
    }
    return {
      published: fetched.outcome === "served" ? fetched.values : [],
      missingProof: new SsoDomainFileNotFoundError(
        `connection ${connectionId}: no matching file is served at ${url}`,
      ),
    };
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

  /** Avoid issuing proof for a waiting claim owned by another organization.
   * The aggregate independently enforces ownership when the proof arrives. */
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

  /** Uses the same deployment-scoped ownership read as the aggregate guards. */
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
   * {@link removeConnection}, which is graced, never through
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
   * Teardown stops routing immediately and requires an alternate sign-in method.
   * Active connections retain their configured final cleanup delay. A paused or
   * already scheduled connection can complete immediately; teardown has no cancel.
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

  /** Every caller must provide its authorized organization. Missing and foreign
   * connections share one refusal, preventing a connection existence oracle. */
  private async requireOrganizationConnection({
    organizationId,
    connectionId,
  }: {
    organizationId: string;
    connectionId: string;
  }): Promise<SsoConnectionState> {
    const state = await this.deps.reads.findConnection({ connectionId });
    if (!state || state.organizationId !== organizationId) {
      throw new SsoConnectionNotFoundError(
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
    commandId,
  }: {
    organizationId: string;
    connectionId: string;
    actor: SelfServeActor;
    commandId?: string;
  }) {
    return {
      tenantId: organizationId,
      organizationId,
      connectionId,
      commandId: commandId ?? newSsoConnectionCommandId(),
      occurredAtMs: this.now(),
      actor: { type: "user" as const, id: actor.userId },
      source: "self-serve" as const,
    };
  }
}

function toConnectionView(
  state: SsoConnectionState | null,
): SelfServeSetupView["connection"] {
  if (!state) return null;
  return {
    connectionId: state.connectionId,
    state: state.state,
    type: state.type,
    providerId: state.idpMetadata.providerId,
    issuer: state.idpMetadata.issuer,
    source: state.source,
    replacesConnectionId: state.replacesConnectionId,
    migrationPhase: state.migrationPhase,
    arrivalPolicy: ssoArrivalPolicy(state),
    tearDownAfterMs: state.tearDownAfterMs,
    verifiedDomains: state.verifiedDomains,
    domainProofs: state.domainVerifications.map((proof) => ({
      domain: proof.domain,
      method: proof.method,
      qualification: qualifySsoDomainOwnership({
        state,
        domain: proof.domain,
      }).status,
      proofState: proof.proofState,
      graceEndsAtMs: proof.graceEndsAtMs,
      evidenceRef: proof.evidenceRef ?? proof.tokenHash,
      note: proof.note ?? null,
      verifier: proof.verifier ?? null,
      verifiedAtMs: proof.verifiedAtMs,
    })),
  };
}

function toRecordView({
  state,
  nowMs,
}: {
  state: SsoConnectionState | null;
  nowMs: number;
}): SelfServeSetupView["record"] {
  const pending = state?.pendingVerification;
  if (pending?.method !== "dns-txt") return null;
  return {
    ...recordLocationFor({ domain: pending.domain }),
    value: null,
    expiresAtMs: pending.expiresAtMs,
    expired: verificationHasExpired({ pending, nowMs }),
  };
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

/** Takes a claim the caller has already established is not withdrawn — see
 *  the filter in `getSetup`, and the note on the view's own `state`. */
function toClaimView(
  claim: SsoDomainClaim & {
    state: Exclude<SsoDomainClaim["state"], "WITHDRAWN">;
  },
): SelfServeDomainClaimView {
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
