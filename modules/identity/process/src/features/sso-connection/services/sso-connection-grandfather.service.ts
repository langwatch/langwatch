import { HandledError } from "@langwatch/handled-error";
import {
  compareConnectionRouting,
  type ConnectionRoutingComparison,
  grandfatheredSsoConnectionId,
  normalizeDomain,
  type SsoConnectionType,
  type SsoIdpMetadata,
} from "@langwatch/identity-contract";

import type { SignInDomainRouting } from "../../signin/services/signin-router.service.ts";
import type { LegacySsoOrganizationRepository } from "../../sso-arrival/repositories/legacy-sso-organization.repository.ts";
import { isTerminalSsoConnection } from "../../sso-domain/rules/sso-domain-ownership.rules.ts";
import type { SsoConnectionReadRepository } from "../repositories/sso-connection.repository.ts";
import { grandfatherCommandId } from "../rules/sso-connection-id.rules.ts";
import type { SsoConnectionService } from "./sso-connection.service.ts";

/**
 * Grandfathering (ADR-117 §5, D04): the organizations that already have
 */

type SsoConnectionGrandfatherOutcome =
  | { status: "finalized"; report: { kind: "no_legacy_sso" } }
  | {
      status: "finalized";
      report: {
        kind: "grandfathered";
        connectionId: string;
        domains: string[];
        eventsAppended: number;
      };
    }
  | {
      status: "migrated";
      report: {
        kind: "routing_disagreement";
        connectionId: string;
        /** Exactly the domains that disagreed, each with both answers. */
        disagreements: {
          domain: string;
          comparison: ConnectionRoutingComparison;
        }[];
      };
    }
  | {
      status: "finalized";
      report: { kind: "legacy_route_beside_connection"; domains: string[] };
    };

interface SsoConnectionGrandfatherDeps {
  connections: SsoConnectionService;
  /** The connections the organization already holds, read before stating its history. */
  connectionReads: Pick<SsoConnectionReadRepository, "findForOrganization">;
  /** Where the legacy strings are read from. */
  legacy: Pick<LegacySsoOrganizationRepository, "getLegacySso">;
  /** The string-based lookup — what decides sign-in today. */
  legacyRouting: SignInDomainRouting;
  /** The projection-based lookup — what will decide it after the flip. */
  connectionRouting: SignInDomainRouting;
  /** How the connection is dialed. `providerId` comes from the org's
   *  `ssoProvider`; the rest is what the deployment already holds, which is
   *  why it arrives as a resolver rather than a constant. */
  idpMetadataFor: (args: { organizationId: string; ssoProvider: string }) => SsoIdpMetadata;
  connectionType?: SsoConnectionType;
  now?: () => number;
}

export class SsoConnectionGrandfatherService {
  static create(deps: SsoConnectionGrandfatherDeps): SsoConnectionGrandfatherService {
    return new SsoConnectionGrandfatherService(deps);
  }

  private readonly deps: SsoConnectionGrandfatherDeps;

  private constructor(deps: SsoConnectionGrandfatherDeps) {
    this.deps = deps;
  }

  async migrateOrganization({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<SsoConnectionGrandfatherOutcome> {
    const legacy = await this.deps.legacy
      .getLegacySso({ organizationId })
      .catch((error: unknown) => {
        if (HandledError.isHandled(error) && error.code === "sso_connection_not_found")
          return undefined;
        throw error;
      });
    // Nothing to grandfather is a finished organization, not a skipped one:
    // there is no legacy path left for it to be held on.
    if (!legacy) {
      return { status: "finalized", report: { kind: "no_legacy_sso" } };
    }

    const domains = [normalizeDomain(legacy.ssoDomain)];
    const connectionId = grandfatheredSsoConnectionId({ organizationId });
    // ADR-124 §7: beside its own live connection the pin stays on the legacy door, as on main.
    // Not an upgrade issue: the org finishes, and the settings read shows the domain to move.
    if (await this.holdsCompetingConnection({ organizationId, connectionId })) {
      return { status: "finalized", report: { kind: "legacy_route_beside_connection", domains } };
    }
    const facts = await this.deps.connections.grandfatherConnection({
      tenantId: organizationId,
      organizationId,
      connectionId,
      commandId: grandfatherCommandId({ organizationId }),
      occurredAtMs: (this.deps.now ?? Date.now)(),
      actor: { type: "system", id: null },
      source: "legacy-grandfathered",
      type: this.deps.connectionType ?? "oidc",
      idp: this.deps.idpMetadataFor({
        organizationId,
        ssoProvider: legacy.ssoProvider,
      }),
      // Today's behavior, kept: an OAuth callback for an unknown person on a
      // routed domain creates them. Changing that at grandfathering would be
      // a behavior change wearing a migration's clothes.
      arrivalPolicy: "admit",
      domains,
    });

    return this.prove({ organizationId, connectionId, domains, facts: facts.length });
  }

  /** Another live connection, unless the grandfathered one exists: a replacement sits beside it. */
  private async holdsCompetingConnection({
    organizationId,
    connectionId,
  }: {
    organizationId: string;
    connectionId: string;
  }): Promise<boolean> {
    const held = await this.deps.connectionReads.findForOrganization({ organizationId });
    if (held.some((connection) => connection.connectionId === connectionId)) return false;
    return held.some((connection) => !isTerminalSsoConnection(connection.state));
  }

  /**
   * The routing proof. Run after the append rather than before, and read through the same ports
   * the router uses rather than the projection directly — a proof that asked the store instead
   * of the port would pass while the port that actually decides sign-in was miswired.
   */
  private async prove({
    connectionId,
    domains,
    facts,
  }: {
    organizationId: string;
    connectionId: string;
    domains: string[];
    facts: number;
  }): Promise<SsoConnectionGrandfatherOutcome> {
    const disagreements: {
      domain: string;
      comparison: ConnectionRoutingComparison;
    }[] = [];
    for (const domain of domains) {
      const [legacy, connection] = await Promise.all([
        this.deps.legacyRouting.findConnectionsForDomain({ domain }),
        this.deps.connectionRouting.findConnectionsForDomain({ domain }),
      ]);
      const comparison = compareConnectionRouting({
        legacy: legacy[0] ?? null,
        connection: connection[0] ?? null,
      });
      if (!comparison.matches) {
        disagreements.push({ domain, comparison });
      }
    }

    if (disagreements.length > 0) {
      return {
        status: "migrated",
        report: { kind: "routing_disagreement", connectionId, disagreements },
      };
    }

    return {
      status: "finalized",
      report: {
        kind: "grandfathered",
        connectionId,
        domains,
        eventsAppended: facts,
      },
    };
  }
}
