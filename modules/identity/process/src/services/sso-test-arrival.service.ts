import { HandledError } from "@langwatch/handled-error";
import {
  isSsoConnectionInSetup,
  looksLikeSsoConnectionId,
  NOT_A_TEST_ARRIVAL,
  type SsoTestArrivalStanding,
} from "@langwatch/identity-contract";

import type { SsoConnectionReadRepository } from "../repositories/sso-connection.repository.ts";

/** Which providers let this person in — auth's answer, since auth owns every
 *  `Account` row (ADR-129). A connection id among them is what is looked for. */
export interface SsoTestArrivalAccounts {
  findAccountProvidersForUser(args: { userId: string }): Promise<readonly string[]>;
}

/** The two membership reads this answer needs, and only those: its own port,
 *  because a service that provisions nobody must not hold the verb that could. */
export interface SsoTestArrivalMemberships {
  /** Belonging to nothing is the whole of what makes a tester stranded. */
  hasAnyMembership(args: { userId: string }): Promise<boolean>;
  findOrganization(args: { organizationId: string }): Promise<{ id: string; name: string } | null>;
}

export interface SsoTestArrivalServiceDeps {
  accounts: SsoTestArrivalAccounts;
  connections: SsoConnectionReadRepository;
  memberships: SsoTestArrivalMemberships;
}

/**
 * Where somebody stands who signed in through a connection that is not live:
 * the mandatory test sign-in, which the arrival gate drops because it admits
 * nobody before ACTIVE. Provisions nobody — it says what is already true.
 */
export class SsoTestArrivalService {
  static create(deps: SsoTestArrivalServiceDeps): SsoTestArrivalService {
    return new SsoTestArrivalService(deps);
  }

  private constructor(private readonly deps: SsoTestArrivalServiceDeps) {}

  /**
   * A MEMBER IS NOT STRANDED: somebody who belongs anywhere lands normally and
   * may create another organization whatever connection they came through, so
   * that read comes first and ends the question for almost everybody.
   */
  async standingFor({ userId }: { userId: string }): Promise<SsoTestArrivalStanding> {
    if (await this.deps.memberships.hasAnyMembership({ userId })) return NOT_A_TEST_ARRIVAL;

    const providers = await this.deps.accounts.findAccountProvidersForUser({ userId });

    for (const provider of providers) {
      // Cheap first: most accounts through this seam are not connections.
      if (!looksLikeSsoConnectionId(provider)) continue;
      const standing = await this.standingThrough({ connectionId: provider });
      if (standing.testing) return standing;
    }

    return NOT_A_TEST_ARRIVAL;
  }

  /** One connection's answer, so the loop above reads as the search it is. */
  private async standingThrough({
    connectionId,
  }: {
    connectionId: string;
  }): Promise<SsoTestArrivalStanding> {
    const connection = await this.deps.connections
      .getConnection({ connectionId })
      .catch((error: unknown) => {
        if (HandledError.isHandled(error) && error.code === "sso_connection_not_found") return null;
        throw error;
      });
    if (!connection) return NOT_A_TEST_ARRIVAL;

    // STILL BEING SET UP, not merely "not live": an account through a
    // discarded, rejected, suspended or torn-down connection has no setup to
    // go back to, and answering would refuse them an organization for good.
    if (!isSsoConnectionInSetup(connection.state)) return NOT_A_TEST_ARRIVAL;

    const organization = await this.deps.memberships.findOrganization({
      organizationId: connection.organizationId,
    });
    if (!organization) return NOT_A_TEST_ARRIVAL;

    return {
      testing: true,
      connectionId,
      organizationId: connection.organizationId,
      organizationName: organization.name,
    };
  }
}
