import {
  compareConnectionRouting,
  type ConnectionRoutingComparison,
  normalizeDomain,
  type SsoConnectionType,
  type SsoIdpMetadata,
} from "@langwatch/identity";
import type { SignInDomainRoutingPort } from "./signin-router.service";
import {
  grandfatherCommandId,
  grandfatheredSsoConnectionId,
} from "./sso-connection-id";
import type { SsoConnectionService } from "./sso-connection.service";

/**
 * Grandfathering (ADR-117 §5, D04): the organizations that already have
 * enterprise SSO get it as connection data, without noticing.
 *
 * Two halves, and the second is the one that matters:
 *
 *  1. State the history the two string columns imply — registered, claimed,
 *     approved, verified, activated — as one command whose id is derived from
 *     the organization, so a second pass costs no event.
 *  2. PROVE it, by routing. For every domain the organization carries, the
 *     connection-based lookup must answer what the string-based one answers.
 *     That is the same comparison `SSOCONN_ROUTING` shadow mode runs on every
 *     live login, evaluated per tenant — one function, so a fleet-wide silent
 *     bake and a per-organization finalization cannot mean different things.
 *
 * Agreement finalizes the organization. Disagreement HOLDS it, with the
 * domains named: the work is done and idempotent to redo, the organization
 * stays on the string path, and a later pass re-proves it once whatever the
 * report names is fixed. Held is not failed.
 */

/** Where the legacy strings are read from. */
export interface LegacySsoOrganizationRepository {
  findLegacySso(args: { organizationId: string }): Promise<{
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
  legacyRouting: SignInDomainRoutingPort;
  /** The projection-based lookup — what will decide it after the flip. */
  connectionRouting: SignInDomainRoutingPort;
  /** How the connection is dialed. `providerId` comes from the org's
   *  `ssoProvider`; the rest is what the deployment already holds, which is
   *  why it arrives as a resolver rather than a constant. */
  idpMetadataFor: (args: {
    organizationId: string;
    ssoProvider: string;
  }) => SsoIdpMetadata;
  connectionType?: SsoConnectionType;
  now?: () => number;
}

export class SsoConnectionGrandfatherService {
  private readonly deps: SsoConnectionGrandfatherDeps;

  constructor(deps: SsoConnectionGrandfatherDeps) {
    this.deps = deps;
  }

  async migrateOrganization({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<SsoConnectionGrandfatherOutcome> {
    const legacy = await this.deps.legacy.findLegacySso({ organizationId });
    // Nothing to grandfather is a finished organization, not a skipped one:
    // there is no legacy path left for it to be held on.
    if (!legacy) return { status: "finalized", report: { kind: "no_legacy_sso" } };

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
   * The routing proof. Run after the append rather than before, and read
   * through the same ports the router uses rather than the projection
   * directly — a proof that asked the store instead of the port would pass
   * while the port that actually decides sign-in was miswired.
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
        this.deps.legacyRouting.findConnectionForDomain({ domain }),
        this.deps.connectionRouting.findConnectionForDomain({ domain }),
      ]);
      const comparison = compareConnectionRouting({ legacy, connection });
      if (!comparison.matches) disagreements.push({ domain, comparison });
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
