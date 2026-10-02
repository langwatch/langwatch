import {
  type SelfServeActor,
  type SsoArrivalPolicy,
  type SsoMigrationRoute,
  SsoActivationArrivalsUndecidedError,
  SsoActivationBreakGlassMissingError,
  SsoActivationDomainUnprovedError,
  SsoActivationTestSignInMissingError,
  SsoConnectionAlreadyRegisteredError,
  type SsoConnectionRemoval,
  SsoConnectionInvalidTransitionError,
  SsoConnectionNotFoundError,
  type SsoConnectionState,
  type SsoCredentialKind,
  SsoCredentialsRequiredError,
  type SsoIdentityProviderView,
  type SsoIdpDialing,
  type SsoIdpRegistration,
  type SsoIdpUpdate,
  type SsoSetupCommand,
  parseSamlIdpConfig,
  ssoConnectionIdpIsEditable,
  ssoDomainVouchesForNewPeople,
} from "@langwatch/identity-contract";

import type {
  SsoBreakGlassBindingRepository,
  SsoConnectionReadRepository,
} from "../repositories/sso-connection.repository.ts";
import type { SsoCredentialRepository } from "../repositories/sso-credential.repository.ts";
import type { SsoMigrationEvidenceRepository } from "../repositories/sso-migration-evidence.repository.ts";
import { newSsoConnectionCommandId, newSsoConnectionId } from "../rules/sso-connection-id.rules.ts";
import type { SsoConnectionService } from "./sso-connection.service.ts";
import type { SsoIdpRegistrationService } from "./sso-idp-registration.service.ts";
import type { SsoMigrationFinalizationService } from "./sso-migration-finalization.service.ts";

/** The states a removal abandons outright — every one before a connection
 *  decides a sign-in. From ACTIVE onwards removal is teardown's. */
const REMOVABLE_BY_DISCARD = new Set([
  "DRAFT",
  "CLAIMED",
  "APPROVED",
  "REJECTED",
  "VERIFICATION_PENDING",
  "VERIFIED",
]);

/** How far back going live looks for a sign-in that named its subject: the
 *  trail is per connection, and a test sign-in is among its newest rows. */
const TEST_SIGN_IN_LOOKBACK = 20;

export interface SsoSetupCommandsServiceDeps {
  connections: () => SsoConnectionService;
  reads: SsoConnectionReadRepository;
  /** The trail going live reads the test sign-in off. */
  activity: SsoMigrationEvidenceRepository;
  credentials: SsoCredentialRepository;
  /** The same "is there a way back in" answer the sign-in exemption reads. */
  breakGlass: SsoBreakGlassBindingRepository;
  registrations: SsoIdpRegistrationService;
  /** The cutover's last verb, which is a ceremony of its own. */
  finalization: SsoMigrationFinalizationService;
  now?: () => number;
}

/**
 * The verbs the setup journey presses (D05 tier 3, D09): each mints a command
 * id, stamps the administrator as the actor and hands the rest to the guards.
 * Registration is the exception — a credential reaches the vault first.
 */
export class SsoSetupCommandsService {
  static create(deps: SsoSetupCommandsServiceDeps): SsoSetupCommandsService {
    return new SsoSetupCommandsService(deps);
  }

  private readonly now: () => number;

  private constructor(private readonly deps: SsoSetupCommandsServiceDeps) {
    this.now = deps.now ?? Date.now;
  }

  /**
   * Registers what an administrator supplied, once it has been checked. The
   * connection arrives turning everybody away: who it admits is a decision
   * the journey takes later, and an unanswered one admits nobody.
   */
  async register({
    organizationId,
    actor,
    providerId,
    registration,
  }: {
    organizationId: string;
    actor: SelfServeActor;
    /** What the administrator calls this provider. */
    providerId: string;
    registration: SsoIdpRegistration;
  }): Promise<{ connectionId: string }> {
    const connectionId = newSsoConnectionId();
    const idp = await this.storeCredentials({ organizationId, connectionId, registration });

    await this.deps.connections().registerConnection({
      ...this.command({ organizationId, connectionId, actor }),
      type: registration.protocol,
      idp: { ...idp, providerId },
      arrivalPolicy: "refuse",
    });

    return { connectionId };
  }

  /** Starts the cutover: the one direct replacement an organization may run
   *  beside its grandfathered connection, carrying the domains it proved.
   *  Asking twice answers with the replacement that already stands. */
  async startLegacyMigration({
    organizationId,
    actor,
    legacyConnectionId,
    providerId,
    registration,
  }: {
    organizationId: string;
    actor: SelfServeActor;
    legacyConnectionId: string;
    providerId: string;
    registration: SsoIdpRegistration;
  }): Promise<{ connectionId: string }> {
    const legacy = await this.requireOrganizationConnection({
      organizationId,
      connectionId: legacyConnectionId,
    });
    if (legacy.source !== "legacy-grandfathered") {
      throw new SsoConnectionAlreadyRegisteredError(
        `connection ${legacyConnectionId} is not a grandfathered provider`,
      );
    }
    const standing = await this.findStandingReplacement({ organizationId, legacyConnectionId });
    if (standing) return { connectionId: standing };

    const connectionId = newSsoConnectionId();
    const idp = await this.storeCredentials({ organizationId, connectionId, registration });
    await this.deps.connections().registerReplacementConnection({
      ...this.command({ organizationId, connectionId, actor }),
      type: registration.protocol,
      idp: { ...idp, providerId },
      arrivalPolicy: "refuse",
      replacesConnectionId: legacyConnectionId,
    });

    return { connectionId };
  }

  /** Which of the pair decides an ordinary sign-in. */
  async selectMigrationRoute({
    organizationId,
    connectionId,
    actor,
    route,
  }: SsoSetupCommand & { route: SsoMigrationRoute }): Promise<void> {
    await this.requireOrganizationConnection({ organizationId, connectionId });
    await this.deps.connections().selectMigrationRoute({
      ...this.command({ organizationId, connectionId, actor }),
      route,
    });
  }

  /** The word on the card. Nothing routes on it (ADR-117). */
  async rename({
    organizationId,
    connectionId,
    actor,
    name,
  }: SsoSetupCommand & { name: string }): Promise<void> {
    await this.requireOrganizationConnection({ organizationId, connectionId });
    await this.deps.connections().renameConnection({
      ...this.command({ organizationId, connectionId, actor }),
      name,
    });
  }

  /**
   * The connection's current identity provider settings, for the edit form.
   * Null for a connection with none of its own: a grandfathered one dials the
   * deployment's legacy provider. Never the OpenID Connect client secret.
   */
  async getIdentityProvider({
    organizationId,
    connectionId,
  }: {
    organizationId: string;
    connectionId: string;
  }): Promise<SsoIdentityProviderView> {
    const state = await this.requireOrganizationConnection({ organizationId, connectionId });
    if (state.source !== "self-serve") return { protocol: "grandfathered" };
    const { idpMetadata } = state;
    if (state.type === "oidc") {
      return {
        protocol: "oidc",
        issuer: idpMetadata.issuer,
        clientId: await this.readCredential({ organizationId, ref: idpMetadata.clientIdRef }),
        hasClientSecret: idpMetadata.secretRef !== null,
      };
    }
    const stored = await this.readCredential({
      organizationId,
      ref: idpMetadata.certRefs[0] ?? null,
    });
    const config = stored === null ? null : parseSamlIdpConfig(stored);
    return {
      protocol: "saml",
      entryPoint: config?.entryPoint ?? null,
      entityId: config?.entityId ?? idpMetadata.issuer,
      metadataXml: config?.metadataXml ?? null,
      certificate: config?.certificate ?? null,
    };
  }

  /**
   * Replaces the identity provider settings on the same id, so the redirect address,
   * domains, proofs, policy and accounts stay. Checked as a registration is before
   * anything is stored; a value matching the stored one keeps its reference.
   */
  async updateIdentityProvider({
    organizationId,
    connectionId,
    actor,
    idp,
  }: SsoSetupCommand & { idp: SsoIdpUpdate }): Promise<void> {
    const state = await this.requireOrganizationConnection({ organizationId, connectionId });
    if (idp.protocol !== state.type) {
      throw new SsoConnectionInvalidTransitionError(
        `connection ${connectionId} speaks ${state.type}; the protocol cannot change on an existing connection`,
      );
    }
    // Refused here as well as by the guard, so a refused edit stores no
    // credential records.
    if (state.source !== "self-serve" || !ssoConnectionIdpIsEditable(state.state)) {
      throw new SsoConnectionInvalidTransitionError(
        `connection ${connectionId} is ${state.source} in ${state.state}; its identity provider settings cannot be replaced`,
      );
    }
    const dialing =
      idp.protocol === "oidc"
        ? await this.prepareOidcUpdate({ state, idp })
        : await this.prepareSamlUpdate({ state, idp });
    await this.deps.connections().updateConnectionIdp({
      ...this.command({ organizationId, connectionId, actor }),
      idp: dialing,
    });
  }

  private async prepareOidcUpdate({
    state,
    idp,
  }: {
    state: SsoConnectionState;
    idp: Extract<SsoIdpUpdate, { protocol: "oidc" }>;
  }): Promise<SsoIdpDialing> {
    const current = state.idpMetadata;
    const clientSecret =
      idp.clientSecret === null || idp.clientSecret.trim() === "" ? null : idp.clientSecret;
    if (clientSecret === null && current.secretRef === null) {
      throw new SsoCredentialsRequiredError("an openid connect connection needs a client secret");
    }
    const { issuer } = await this.deps.registrations.validateOidcRegistration({
      ...idp,
      // A blank secret keeps the stored one, which satisfies the presence check.
      clientSecret: clientSecret ?? "stored",
    });
    const clientIdRef = await this.keptOrStoredCredential({
      state,
      ref: current.clientIdRef,
      kind: "oidc-client-id",
      value: idp.clientId,
    });
    const secretRef =
      clientSecret === null
        ? current.secretRef
        : await this.keptOrStoredCredential({
            state,
            ref: current.secretRef,
            kind: "oidc-client-secret",
            value: clientSecret,
          });
    return { issuer, clientIdRef, secretRef, certRefs: [] };
  }

  private async prepareSamlUpdate({
    state,
    idp,
  }: {
    state: SsoConnectionState;
    idp: Extract<SsoIdpUpdate, { protocol: "saml" }>;
  }): Promise<SsoIdpDialing> {
    const config = this.deps.registrations.validateSamlRegistration(idp);
    const certRef = await this.keptOrStoredCredential({
      state,
      ref: state.idpMetadata.certRefs[0] ?? null,
      kind: "saml-idp-config",
      value: JSON.stringify(config),
    });
    return { issuer: config.entityId, clientIdRef: null, secretRef: null, certRefs: [certRef] };
  }

  /** The stored reference when it already holds this value, otherwise a new
   *  one. A changed value always gets a new reference, so the log records
   *  when a credential changed. */
  private async keptOrStoredCredential({
    state: { organizationId, connectionId },
    ref,
    kind,
    value,
  }: {
    state: SsoConnectionState;
    ref: string | null;
    kind: SsoCredentialKind;
    value: string;
  }): Promise<string> {
    if ((await this.readCredential({ organizationId, ref })) === value && ref !== null) return ref;
    return this.deps.credentials.put({ organizationId, connectionId, kind, value });
  }

  private async readCredential({
    organizationId,
    ref,
  }: {
    organizationId: string;
    ref: string | null;
  }): Promise<string | null> {
    if (ref === null) return null;
    const read = await this.deps.credentials.read({ organizationId, ref });
    return read.found ? read.value : null;
  }

  /** Who this connection admits (ADR-117 §3). */
  async setArrivals({
    organizationId,
    connectionId,
    actor,
    arrivalPolicy,
  }: SsoSetupCommand & { arrivalPolicy: SsoArrivalPolicy }): Promise<void> {
    await this.requireOrganizationConnection({ organizationId, connectionId });
    await this.deps.connections().setArrivalPolicy({
      ...this.command({ organizationId, connectionId, actor }),
      policy: arrivalPolicy,
    });
  }

  /**
   * Takes it live on the strength of the sign-in it recorded. The account is
   * RESOLVED here rather than supplied: a caller naming one would assert the
   * test sign-in it is meant to be evidence of.
   */
  async activate({ organizationId, connectionId, actor }: SsoSetupCommand): Promise<void> {
    const state = await this.requireOrganizationConnection({ organizationId, connectionId });
    if (state.state !== "ACTIVE") await this.requirePreconditionsInScreenOrder(state);
    await this.deps.connections().activateConnection({
      ...this.command({ organizationId, connectionId, actor }),
      testLoginAccountId: await this.testSignInAccountOf(state),
    });
  }

  /** Names the first unmet precondition; the guard rechecks all of them for every caller. */
  private async requirePreconditionsInScreenOrder(state: SsoConnectionState): Promise<void> {
    const domainProved = state.verifiedDomains.some((domain) =>
      ssoDomainVouchesForNewPeople({ state, domain }),
    );
    if (!domainProved) {
      throw new SsoActivationDomainUnprovedError(
        `connection ${state.connectionId}: no domain is proved`,
      );
    }
    await this.testSignInAccountOf(state);
    const wayBackIn = await this.deps.breakGlass.hasLiveBinding({
      organizationId: state.organizationId,
    });
    if (!wayBackIn) {
      throw new SsoActivationBreakGlassMissingError(
        `organization ${state.organizationId}: no live way in without the identity provider`,
      );
    }
    if (state.arrivalPolicyDecidedAtMs === null) {
      throw new SsoActivationArrivalsUndecidedError(
        `connection ${state.connectionId}: nobody has said who it admits`,
      );
    }
  }

  /** The subject the newest recorded sign-in asserted. A connection nobody
   *  has signed in through is not one that can go live. */
  private async testSignInAccountOf(state: SsoConnectionState): Promise<string> {
    if (state.testLoginAccountId) return state.testLoginAccountId;

    const recent = await this.deps.activity.findRecentAuthentications({
      organizationId: state.organizationId,
      connectionId: state.connectionId,
      limit: TEST_SIGN_IN_LOOKBACK,
      issuer: state.idpMetadata.issuer,
    });
    const asserted = recent.find((record) => record.providerAccountId !== null);
    if (!asserted?.providerAccountId) {
      throw new SsoActivationTestSignInMissingError(
        `connection ${state.connectionId}: nobody has signed in through it`,
      );
    }
    return asserted.providerAccountId;
  }

  /**
   * Finishes the cutover: the legacy half stops deciding sign-ins and nothing
   * it minted still lets anybody in. Refused by name while any blocker
   * stands, and resumable after an interrupted attempt.
   */
  async finalizeLegacyMigration({
    organizationId,
    connectionId,
    actor,
  }: SsoSetupCommand): Promise<void> {
    await this.requireOrganizationConnection({ organizationId, connectionId });
    await this.deps.finalization.finalize({
      organizationId,
      replacementConnectionId: connectionId,
      actorUserId: actor.userId,
    });
  }

  /** Abandons a setup nobody finished. */
  async discardConnection({ organizationId, connectionId, actor }: SsoSetupCommand): Promise<void> {
    await this.requireOrganizationConnection({ organizationId, connectionId });
    await this.deps
      .connections()
      .discardConnection(this.command({ organizationId, connectionId, actor }));
  }

  /** Takes a connection away. WHICH removal that is comes from where it
   *  stands: a setup is discarded outright, one deciding sign-ins is torn
   *  down after a grace, so no press locks anybody out. */
  async removeConnection({
    organizationId,
    connectionId,
    actor,
    reason,
    graceMs,
  }: SsoSetupCommand & { reason: string | null; graceMs: number }): Promise<{
    removal: SsoConnectionRemoval;
  }> {
    const state = await this.requireOrganizationConnection({ organizationId, connectionId });
    const command = this.command({ organizationId, connectionId, actor });

    // Not "is it ACTIVE": a paused connection and one already being removed
    // are both not active, and neither can be discarded.
    if (REMOVABLE_BY_DISCARD.has(state.state)) {
      await this.deps.connections().discardConnection(command);
      return { removal: "discarded" };
    }

    // A paused connection carries nobody, so the week would protect nobody.
    const carriesNobody = state.state === "SUSPENDED";
    await this.deps.connections().requestTeardown({
      ...command,
      reason,
      graceMs: carriesNobody ? 0 : graceMs,
    });
    return { removal: "teardown-requested" };
  }

  /**
   * The vault half of a registration. OpenID Connect keeps its two values
   * apart because they are read apart; SAML keeps one document, because half
   * a SAML provider cannot be dialled.
   */
  private async storeCredentials({
    organizationId,
    connectionId,
    registration,
  }: {
    organizationId: string;
    connectionId: string;
    registration: SsoIdpRegistration;
  }): Promise<{
    issuer: string | null;
    clientIdRef: string | null;
    secretRef: string | null;
    certRefs: string[];
  }> {
    const vault = (kind: "oidc-client-id" | "oidc-client-secret" | "saml-idp-config") =>
      ({ organizationId, connectionId, kind }) as const;

    if (registration.protocol === "oidc") {
      const { issuer } = await this.deps.registrations.validateOidcRegistration(registration);

      return {
        issuer,
        clientIdRef: await this.deps.credentials.put({
          ...vault("oidc-client-id"),
          value: registration.clientId,
        }),
        secretRef: await this.deps.credentials.put({
          ...vault("oidc-client-secret"),
          value: registration.clientSecret,
        }),
        certRefs: [],
      };
    }

    const config = this.deps.registrations.validateSamlRegistration(registration);
    // The whole dialing document under one reference; `certRefs` is where a
    // connection carries what it was given rather than what it was told.
    const ref = await this.deps.credentials.put({
      ...vault("saml-idp-config"),
      value: JSON.stringify(config),
    });

    return { issuer: config.entityId, clientIdRef: null, secretRef: null, certRefs: [ref] };
  }

  /** The replacement already registered against this legacy connection and
   *  not abandoned, if there is one. */
  private async findStandingReplacement({
    organizationId,
    legacyConnectionId,
  }: {
    organizationId: string;
    legacyConnectionId: string;
  }): Promise<string | null> {
    const held = await this.deps.reads.findForOrganization({ organizationId });
    const standing = held.find(
      (connection) =>
        connection.replacesConnectionId === legacyConnectionId &&
        connection.state !== "DISCARDED" &&
        connection.state !== "TORN_DOWN",
    );

    return standing?.connectionId ?? null;
  }

  /** Missing and foreign connections share one refusal, so a caller cannot
   *  learn that a connection it may not read exists. */
  private async requireOrganizationConnection({
    organizationId,
    connectionId,
  }: {
    organizationId: string;
    connectionId: string;
  }): Promise<SsoConnectionState> {
    const state = await this.deps.reads.getConnection({ connectionId });
    if (state.organizationId !== organizationId) {
      throw new SsoConnectionNotFoundError(`connection ${connectionId} does not exist`);
    }

    return state;
  }

  /** The identity block every command carries. Minted here so no caller can
   *  supply an actor: the administrator the surface authenticated is it. */
  private command({ organizationId, connectionId, actor }: SsoSetupCommand) {
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
