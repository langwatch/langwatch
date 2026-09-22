import {
  type SelfServeActor,
  type SsoArrivalPolicy,
  type SsoMigrationRoute,
  SsoConnectionActivationBlockedError,
  SsoConnectionAlreadyRegisteredError,
  type SsoConnectionRemoval,
  SsoConnectionNotFoundError,
  type SsoConnectionState,
  type SsoIdpRegistration,
  type SsoSetupCommand,
} from "@langwatch/identity-contract";

import type { SsoConnectionReadRepository } from "../repositories/sso-connection.repository.ts";
import type { SsoCredentialRepository } from "../repositories/sso-credential.repository.ts";
import type { SsoMigrationEvidenceRepository } from "../repositories/sso-migration-evidence.repository.ts";
import { newSsoConnectionCommandId, newSsoConnectionId } from "../rules/sso-connection-id.rules.ts";
import type { SsoConnectionService } from "./sso-connection.service.ts";
import type { SsoIdpRegistrationService } from "./sso-idp-registration.service.ts";

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
  registrations: SsoIdpRegistrationService;
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
    await this.deps.connections().activateConnection({
      ...this.command({ organizationId, connectionId, actor }),
      testLoginAccountId: await this.testSignInAccountOf(state),
    });
  }

  /** The subject the newest recorded sign-in asserted. A connection nobody
   *  has signed in through is not one that can go live. */
  private async testSignInAccountOf(state: SsoConnectionState): Promise<string> {
    if (state.testLoginAccountId) return state.testLoginAccountId;

    const recent = await this.deps.activity.findRecentAuthentications({
      organizationId: state.organizationId,
      connectionId: state.connectionId,
      limit: TEST_SIGN_IN_LOOKBACK,
    });
    const asserted = recent.find((record) => record.providerAccountId !== null);
    if (!asserted?.providerAccountId) {
      throw new SsoConnectionActivationBlockedError(
        `connection ${state.connectionId}: nobody has signed in through it`,
      );
    }
    return asserted.providerAccountId;
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

    await this.deps.connections().requestTeardown({ ...command, reason, graceMs });
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
      await this.deps.registrations.validateOidcRegistration(registration);

      return {
        issuer: registration.issuer,
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
    const state = await this.deps.reads.tryFindConnection({ connectionId });
    if (!state || state.organizationId !== organizationId) {
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
