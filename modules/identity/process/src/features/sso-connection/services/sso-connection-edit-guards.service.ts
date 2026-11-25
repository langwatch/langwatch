import { HandledError } from "@langwatch/handled-error";
import {
  type RegisterReplacementConnectionCommandData,
  REPLACEMENT_CONNECTION_REGISTERED_EVENT_TYPE,
  RENAME_CONNECTION_COMMAND_TYPE,
  type RenameConnectionCommandData,
  CONNECTION_RENAMED_EVENT_TYPE,
  UPDATE_CONNECTION_IDP_COMMAND_TYPE,
  type UpdateConnectionIdpCommandData,
  CONNECTION_IDP_UPDATED_EVENT_TYPE,
  SELECT_MIGRATION_ROUTE_COMMAND_TYPE,
  type SelectMigrationRouteCommandData,
  MIGRATION_ROUTE_SELECTED_EVENT_TYPE,
  BEGIN_MIGRATION_FINALIZATION_COMMAND_TYPE,
  type BeginMigrationFinalizationCommandData,
  MIGRATION_FINALIZATION_STARTED_EVENT_TYPE,
  FINALIZE_MIGRATION_COMMAND_TYPE,
  type FinalizeMigrationCommandData,
  MIGRATION_FINALIZED_EVENT_TYPE,
  qualifySsoDomainOwnership,
  SsoConnectionAlreadyRegisteredError,
  type SsoConnectionFactInput,
  type SsoConnectionState,
  SsoConnectionInvalidTransitionError,
} from "@langwatch/identity-contract";

import type { SsoConnectionGuardChecksService } from "./sso-connection-guard-checks.service.ts";

/** The connection edit and migration guards: rename, IdP update, replacement. */
export class SsoConnectionEditGuardsService {
  static create({
    checks,
  }: {
    checks: SsoConnectionGuardChecksService;
  }): SsoConnectionEditGuardsService {
    return new SsoConnectionEditGuardsService(checks);
  }

  private readonly checks: SsoConnectionGuardChecksService;

  private constructor(checks: SsoConnectionGuardChecksService) {
    this.checks = checks;
  }

  /** The word on the card. Renaming to the name it already has costs no
   *  fact: unlike the arrival policy, there is no "somebody has decided" for
   *  a name to be evidence of. */
  async renameConnection(data: RenameConnectionCommandData): Promise<SsoConnectionFactInput[]> {
    const state = await this.checks.require(data, RENAME_CONNECTION_COMMAND_TYPE);
    const name = data.name.trim();
    if (state.idpMetadata.providerId === name) {
      return [];
    }

    return [
      {
        type: CONNECTION_RENAMED_EVENT_TYPE,
        data: {
          connectionId: data.connectionId,
          name,
          actor: data.actor,
          source: data.source,
        },
      },
    ];
  }

  /**
   * The dialing information, replaced on the same connection id; the caller checked
   * and stored the values. Grandfathered connections and protocol changes are
   * refused, and identical settings cost no fact.
   */
  async updateConnectionIdp(
    data: UpdateConnectionIdpCommandData,
  ): Promise<SsoConnectionFactInput[]> {
    const state = await this.checks.require(data, UPDATE_CONNECTION_IDP_COMMAND_TYPE);
    if (state.source !== "self-serve") {
      throw new SsoConnectionInvalidTransitionError(
        `connection ${data.connectionId} is grandfathered and has no identity provider settings to replace`,
      );
    }
    const { idp } = data;
    const fitsProtocol =
      state.type === "oidc"
        ? idp.issuer !== null &&
          idp.clientIdRef !== null &&
          idp.secretRef !== null &&
          idp.certRefs.length === 0
        : idp.clientIdRef === null && idp.secretRef === null && idp.certRefs.length === 1;
    if (!fitsProtocol) {
      throw new SsoConnectionInvalidTransitionError(
        `connection ${data.connectionId} speaks ${state.type}; the protocol cannot change on an existing connection`,
      );
    }
    if (dialsTheSame({ current: state.idpMetadata, next: idp })) return [];

    return [
      {
        type: CONNECTION_IDP_UPDATED_EVENT_TYPE,
        data: { connectionId: data.connectionId, idp, actor: data.actor, source: data.source },
      },
    ];
  }

  /**
   * The one direct replacement an organization may run beside its
   * grandfathered connection. The proofs that still qualify come with it, so
   * a customer never re-proves a domain they have already proved.
   */
  async registerReplacementConnection(
    data: RegisterReplacementConnectionCommandData,
  ): Promise<SsoConnectionFactInput[]> {
    const existing = await this.checks
      .getConnection({ connectionId: data.connectionId })
      .catch((error: unknown) => {
        if (HandledError.isHandled(error) && error.code === "sso_connection_not_found") return null;
        throw error;
      });
    if (existing) {
      // A retry of the same registration states nothing; an id held by
      // anything else is refused rather than moved.
      if (
        existing.organizationId === data.organizationId &&
        existing.replacesConnectionId === data.replacesConnectionId
      ) {
        return [];
      }

      throw new SsoConnectionAlreadyRegisteredError(
        `connection ${data.connectionId} is already registered`,
      );
    }

    const predecessor = await this.checks
      .getConnection({ connectionId: data.replacesConnectionId })
      .catch((error: unknown) => {
        if (HandledError.isHandled(error) && error.code === "sso_connection_not_found") return null;
        throw error;
      });
    if (
      predecessor?.organizationId !== data.organizationId ||
      predecessor.source !== "legacy-grandfathered" ||
      predecessor.state !== "ACTIVE"
    ) {
      throw new SsoConnectionInvalidTransitionError(
        `connection ${data.replacesConnectionId} is not an active grandfathered connection for organization ${data.organizationId}`,
      );
    }
    await this.checks.refuseCompetingConnection({
      organizationId: data.organizationId,
      connectionId: data.connectionId,
      kind: "direct",
      allowedConnectionId: data.replacesConnectionId,
    });
    await this.checks.claimRegistrationSlot({
      organizationId: data.organizationId,
      connectionId: data.connectionId,
      commandId: data.commandId,
      kind: "direct",
      replacesConnectionId: data.replacesConnectionId,
    });

    return [
      {
        type: REPLACEMENT_CONNECTION_REGISTERED_EVENT_TYPE,
        data: {
          connectionId: data.connectionId,
          organizationId: data.organizationId,
          type: data.type,
          idp: data.idp,
          arrivalPolicy: data.arrivalPolicy,
          replacesConnectionId: data.replacesConnectionId,
          inheritedDomainVerifications: predecessor.domainVerifications.filter(
            (proof) =>
              qualifySsoDomainOwnership({ state: predecessor, domain: proof.domain }).status ===
              "QUALIFIED",
          ),
          actor: data.actor,
          source: data.source,
        },
      },
    ];
  }

  /** Which of the pair decides an ordinary sign-in. Locked once finalization
   *  has started: past that point the legacy route is being dismantled. */
  async selectMigrationRoute(
    data: SelectMigrationRouteCommandData,
  ): Promise<SsoConnectionFactInput[]> {
    const state = await this.checks.require(data, SELECT_MIGRATION_ROUTE_COMMAND_TYPE);
    this.requireReplacementMigration(state);
    if (state.migrationPhase === "FINALIZING" || state.migrationPhase === "FINALIZED") {
      throw new SsoConnectionInvalidTransitionError(
        `connection ${data.connectionId}: migration route is locked in ${state.migrationPhase}`,
      );
    }
    const selected = data.route === "legacy" ? "GRACE_LEGACY" : "GRACE_DIRECT";
    if (state.migrationPhase === selected) {
      return [];
    }

    return [
      {
        type: MIGRATION_ROUTE_SELECTED_EVENT_TYPE,
        data: {
          connectionId: data.connectionId,
          route: data.route,
          actor: data.actor,
          source: data.source,
        },
      },
    ];
  }

  /** The durable gate: it lands BEFORE any account is removed, so a process
   *  that dies mid-retirement resumes instead of pretending it finished. */
  async beginMigrationFinalization(
    data: BeginMigrationFinalizationCommandData,
  ): Promise<SsoConnectionFactInput[]> {
    const state = await this.checks.require(data, BEGIN_MIGRATION_FINALIZATION_COMMAND_TYPE);
    this.requireReplacementMigration(state);
    if (state.migrationPhase === "FINALIZING") {
      return [];
    }
    if (state.migrationPhase !== "GRACE_DIRECT") {
      throw new SsoConnectionInvalidTransitionError(
        `connection ${data.connectionId}: finalization requires the direct migration route`,
      );
    }

    return [
      {
        type: MIGRATION_FINALIZATION_STARTED_EVENT_TYPE,
        data: {
          connectionId: data.connectionId,
          actor: data.actor,
          source: data.source,
        },
      },
    ];
  }

  async finalizeMigration(data: FinalizeMigrationCommandData): Promise<SsoConnectionFactInput[]> {
    const state = await this.checks.require(data, FINALIZE_MIGRATION_COMMAND_TYPE);
    this.requireReplacementMigration(state);
    if (state.migrationPhase === "FINALIZED") {
      return [];
    }
    if (state.migrationPhase !== "FINALIZING") {
      throw new SsoConnectionInvalidTransitionError(
        `connection ${data.connectionId}: migration has not entered finalization`,
      );
    }

    return [
      {
        type: MIGRATION_FINALIZED_EVENT_TYPE,
        data: {
          connectionId: data.connectionId,
          actor: data.actor,
          source: data.source,
        },
      },
    ];
  }

  /** A migration verb on a connection that replaces nothing is a mistake,
   *  not a step: it would write a phase onto a connection no pair contains. */
  private requireReplacementMigration(state: SsoConnectionState): void {
    if (state.replacesConnectionId === null || state.migrationPhase === null) {
      throw new SsoConnectionInvalidTransitionError(
        `connection ${state.connectionId} is not a legacy replacement`,
      );
    }
  }
}

/** Whether an identity provider update would dial exactly what is stored. */
function dialsTheSame({
  current,
  next,
}: {
  current: UpdateConnectionIdpCommandData["idp"];
  next: UpdateConnectionIdpCommandData["idp"];
}): boolean {
  if (current.issuer !== next.issuer) return false;
  if (current.clientIdRef !== next.clientIdRef) return false;
  if (current.secretRef !== next.secretRef) return false;
  if (current.certRefs.length !== next.certRefs.length) return false;
  return current.certRefs.every((ref, index) => ref === next.certRefs[index]);
}
