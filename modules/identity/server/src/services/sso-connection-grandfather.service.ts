import {
  compareConnectionRouting,
  type ConnectionRoutingComparison,
  normalizeDomain,
  type SsoConnectionType,
  type SsoIdpMetadata,
} from "@langwatch/identity-contract";
import type { SignInDomainRouting } from "./signin-router.service.ts";
import {
  grandfatherCommandId,
  grandfatheredSsoConnectionId,
} from "../rules/sso-connection-id.rules.ts";
import type { SsoConnectionService } from "./sso-connection.service.ts";

/**
 * Grandfathering (ADR-117 §5, D04): the organizations that already have
 */

/** Where the legacy strings are read from. */
export interface LegacySsoOrganizationRepository {
  tryFindLegacySso(args: { organizationId: string }): Promise<{
    ssoDomain: string;
    ssoProvider: string;
  } | null>;
}

export type SsoConnectionGrandfatherOutcome =
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
    };

export interface SsoConnectionGrandfatherDeps {
  connections: SsoConnectionService;
  legacy: LegacySsoOrganizationRepository;
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
    const legacy = await this.deps.legacy.tryFindLegacySso({ organizationId });
    // Nothing to grandfather is a finished organization, not a skipped one:
    // there is no legacy path left for it to be held on.
    if (!legacy) {
      return { status: "finalized", report: { kind: "no_legacy_sso" } };
    }

    const domains = [normalizeDomain(legacy.ssoDomain)];
    const connectionId = grandfatheredSsoConnectionId({ organizationId });
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
      allowsJit: true,
      domains,
    });

    return this.prove({ organizationId, connectionId, domains, facts: facts.length });
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
        this.deps.legacyRouting.tryFindConnectionForDomain({ domain }),
        this.deps.connectionRouting.tryFindConnectionForDomain({ domain }),
      ]);
      const comparison = compareConnectionRouting({ legacy, connection });
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
