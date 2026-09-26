// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import {
  isSsoConnectionInSetup,
  looksLikeSsoConnectionId,
} from "@langwatch/identity";
import type { SignInConnectionReadsPort } from "./sso-assertion.service";

/**
 * Where somebody stands who signed in through a connection that is not live
 * yet — the pre-activation arrival, which on every setup is the
 * administrator's own mandatory test sign-in.
 *
 * WHY THIS IS A SERVER QUESTION. Going live requires a test sign-in, and a
 * test sign-in necessarily happens while the connection is still VERIFIED.
 * The arrival gate admits nobody before ACTIVE (`domainStanding().live`), so
 * the tester is authenticated, holds no membership, and the orgless landing
 * offers them the screen that creates an organization — the "handed a brand
 * new workspace of their own" outcome the decided-arrivals precondition was
 * added to prevent, reached by the one sign-in the checklist demands.
 *
 * NOTHING IS TAKEN FROM THE BROWSER. The setup screen marks its own callback
 * URL so it can tell whose `?error=` is on the page, and that marker is
 * client-set, client-read and trivially forged — fine for choosing which card
 * renders a message, worthless as evidence. The account the sign-in left
 * behind names its connection (better-auth stores the connection id as the
 * account's provider, the same fact that ticks the test sign-in step), and
 * the connection's own state says whether it is live. That pair is the whole
 * of the evidence and none of it crosses the browser.
 *
 * The arrival rule is untouched: this service provisions nobody and admits
 * nobody. It only answers what is already true, so the product can stop
 * treating a tester as a fresh signup.
 */
export interface SsoTestArrivalAccountsPort {
  /** Every provider this user holds an account through, newest first. The
   *  connection ids among them are what this service is looking for. */
  findAccountProvidersForUser(args: {
    userId: string;
  }): Promise<readonly string[]>;
}

/** A session held through a connection that has not gone live. */
export interface SsoTestArrivalStanding {
  connectionId: string;
  organizationId: string;
  /** Named so the screen can say which organization the tester was proving,
   *  rather than showing them an opaque id. */
  organizationName: string;
}

/**
 * The two membership reads this answer needs, and only those.
 *
 * Its own port rather than the arrival service's: that one carries
 * `createMembership`, and a service that provisions nobody must not be handed
 * the verb that could — nor should every one of that port's existing callers
 * have to stub a question only this service asks.
 */
export interface SsoTestArrivalMembershipsPort {
  /** Whether this person belongs to ANY organization. Belonging to nothing is
   *  the whole of what makes a stranded tester stranded. */
  hasAnyMembership(args: { userId: string }): Promise<boolean>;
  /** The organization the connection belongs to, named so the screen can say
   *  which one rather than showing an opaque id. */
  findOrganizationForMembership(args: {
    organizationId: string;
  }): Promise<{ id: string; name: string } | null>;
}

export interface SsoTestArrivalServiceDeps {
  accounts: SsoTestArrivalAccountsPort;
  connections: SignInConnectionReadsPort;
  memberships: SsoTestArrivalMembershipsPort;
}

export class SsoTestArrivalService {
  constructor(private readonly deps: SsoTestArrivalServiceDeps) {}

  /**
   * Null for almost everybody, which is the point: the question is asked on a
   * dead-end landing and before an organization is created, both of which are
   * rare, and every ordinary session answers it with one indexed read.
   *
   * A MEMBER IS NOT STRANDED — of this organization or of any other. An
   * administrator who tests their own connection is already a member and
   * lands normally, and somebody who belongs elsewhere is entitled to create
   * an organization whatever connection they once came through. Answering for
   * either would refuse them something they may have.
   */
  async standingFor({
    userId,
  }: {
    userId: string;
  }): Promise<SsoTestArrivalStanding | null> {
    // BELONGING TO NOTHING IS THE WHOLE OF IT. Somebody who already has an
    // organization is not stranded: they land normally, and they are entitled
    // to create another whatever connection they once signed in through.
    // Asked first because it is one indexed read and it ends the question for
    // everybody who is not the person this describes.
    if (await this.deps.memberships.hasAnyMembership({ userId })) return null;

    const providers = await this.deps.accounts.findAccountProvidersForUser({
      userId,
    });

    for (const provider of providers) {
      // Cheap first: most accounts through this seam are not connections.
      if (!looksLikeSsoConnectionId(provider)) continue;
      const standing = await this.standingThrough({
        userId,
        connectionId: provider,
      });
      if (standing) return standing;
    }

    return null;
  }

  /** One connection's answer, so the loop above reads as the search it is. */
  private async standingThrough({
    userId,
    connectionId,
  }: {
    userId: string;
    connectionId: string;
  }): Promise<SsoTestArrivalStanding | null> {
    const connection = await this.deps.connections.findConnectionForSignIn({
      connectionId,
    });
    if (!connection) return null;

    // STILL BEING SET UP, not merely "not live". A discarded, rejected,
    // suspended or torn-down connection is also not ACTIVE, and the person
    // holding an account through one has no setup to go back and finish —
    // answering for them would tell them to complete something that no longer
    // exists and refuse them an organization for good.
    if (!isSsoConnectionInSetup(connection.state)) return null;

    const organization =
      await this.deps.memberships.findOrganizationForMembership({
        organizationId: connection.organizationId,
      });
    if (!organization) return null;

    return {
      connectionId,
      organizationId: connection.organizationId,
      organizationName: organization.name,
    };
  }
}
