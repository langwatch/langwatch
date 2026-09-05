import {
  disputedDomainClaimQueue,
  LIVE_IDENTIFIER_STATES,
  type SsoConnectionState,
  type SsoDomainClaimQueueEntry,
  waitingDomainClaims,
} from "@langwatch/identity";
import type {
  SsoConnectionReadRepository,
  SsoConnectionStrandingRepository,
  SsoDomainClaimQueueRepository,
} from "@langwatch/identity-server";
import type { PrismaClient } from "~/generated/prisma/client";
import type { SignInConnection } from "../sso-assertion.service";
import { rowToConnection } from "./sso-connection-projection.prisma.repository";

/**
 * The reads the connection guards run (D04, ADR-117 §5), over the
 * `SsoConnection` projection. Policy — what a state allows, who owns a domain
 * — lives in `@langwatch/identity-server`; this class returns stored facts.
 */
export class PrismaSsoConnectionReadRepository
  implements SsoConnectionReadRepository
{
  constructor(private readonly prisma: PrismaClient) {}

  async findConnection({
    connectionId,
  }: {
    connectionId: string;
  }): Promise<SsoConnectionState | null> {
    const row = await this.prisma.ssoConnection.findUnique({
      where: { id: connectionId },
    });
    return row === null ? null : rowToConnection(row);
  }

  /**
   * First verifier owns, and this is where the scope of "owns" is decided.
   *
   * The query is deliberately unscoped by organization: on cloud that IS the
   * global rule, and on a self-hosted installation this table only ever holds
   * that installation's own connections, so the same statement means
   * "per-instance" there without a branch. Scoping it by deployment mode
   * would be a branch that is a no-op on one side and a hole on the other.
   */
  async findDomainOwner({
    domain,
  }: {
    domain: string;
  }): Promise<{ connectionId: string; organizationId: string } | null> {
    const row = await this.prisma.ssoConnection.findFirst({
      // A PROOF, not a live connection. Filtering to ACTIVE meant a
      // connection that had proved `acme.com` but sat at VERIFIED, SUSPENDED
      // or TEARDOWN_PENDING owned nothing — so a second organization could
      // claim the same domain, prove it, and activate, and then routing
      // picked between two live connections by `updatedAt`. "First verifier
      // owns" has to mean whoever verified it, whatever they have done since.
      //
      // The terminal states are the exception and the only one: a connection
      // that was discarded or torn down is gone, and holding a domain
      // hostage afterwards would make removal a thing customers could not
      // undo.
      where: {
        state: { notIn: ["DISCARDED", "TORN_DOWN"] },
        verifiedDomains: { has: domain },
      },
      select: { id: true, organizationId: true },
    });
    return row === null
      ? null
      : { connectionId: row.id, organizationId: row.organizationId };
  }

  /**
   * The one connection an organization is setting up or running.
   *
   * Terminal states are excluded rather than ordered around: a discarded or
   * torn-down connection is a tombstone, and an organization whose
   * connection was removed is setting up from nothing again. Most recently
   * touched first, so an organization that somehow holds two — a back-office
   * registration alongside a self-served one — sees the live one.
   */
  async findConnectionForOrganization({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<SsoConnectionState | null> {
    const row = await this.prisma.ssoConnection.findFirst({
      where: {
        organizationId,
        state: { notIn: ["DISCARDED", "TORN_DOWN"] },
      },
      orderBy: { updatedAt: "desc" },
    });
    return row === null ? null : rowToConnection(row);
  }

  /**
   * The connection an assertion names, as the two sign-in decisions read it
   * (ADR-129): may this connection assert this address, and what happens to
   * somebody arriving through it.
   *
   * A narrow projection rather than `findConnection` above, and `lapsedDomains`
   * from the COLUMN rather than re-derived from the proofs: the column is what
   * the reproof sweep writes, so a domain whose grace expires mid-request is
   * still routing until that sweep says otherwise (ADR-123). Deriving it here
   * would move the moment a domain stops provisioning off the sweep and onto
   * whoever happens to sign in.
   */
  async findConnectionForSignIn({
    connectionId,
  }: {
    connectionId: string;
  }): Promise<SignInConnection | null> {
    return await this.prisma.ssoConnection.findUnique({
      where: { id: connectionId },
      select: {
        organizationId: true,
        state: true,
        verifiedDomains: true,
        lapsedDomains: true,
        arrivalPolicy: true,
        createdBy: true,
      },
    });
  }

  /**
   * How many ACTIVE connections this organization has right now.
   *
   * The break-glass revoke guard's one outside fact: revoking the last way
   * back in matters only while a connection is actually deciding this
   * organization's sign-in. A count rather than the rows, because the guard
   * asks whether there is any and reads nothing about them.
   */
  async countActiveConnections({
    organizationId,
  }: {
    organizationId: string;
  }): Promise<number> {
    return await this.prisma.ssoConnection.count({
      where: { organizationId, state: "ACTIVE" },
    });
  }
}

/**
 * The operator queue (D05), which is disputes only: a claim on a domain some
 * OTHER organization has already proved, longest wait first.
 *
 * Everything else left this queue when the published record became the
 * decision. An uncontested claim is finished by the customer publishing DNS,
 * with no operator command anywhere in its history, so listing it would be
 * listing work nobody has to do — and burying the one entry that IS work
 * under a hundred that are not is how a queue stops being read.
 *
 * Two reads rather than one: the claims that are waiting, then who already
 * holds those domains. The second is unscoped by organization for the same
 * reason `findDomainOwner` is — a dispute is by definition about somebody
 * else's connection — and the model is exempt from the org guard on exactly
 * that ground.
 *
 * The waiting claims live in the `domainClaims` column rather than in rows of
 * their own, so the scan is over connections that are CLAIMED and the sort is
 * in memory. That is honest at this size — a queue with more entries than one
 * page is a staffing incident, which is the thing Open Q2 is about — and it
 * keeps one aggregate as the only writer of what a claim's state is.
 */
export class PrismaSsoDomainClaimQueueRepository
  implements SsoDomainClaimQueueRepository
{
  constructor(private readonly prisma: PrismaClient) {}

  async findAllDisputed({
    limit,
  }: {
    limit: number;
  }): Promise<SsoDomainClaimQueueEntry[]> {
    const rows = await this.prisma.ssoConnection.findMany({
      where: { state: "CLAIMED" },
      orderBy: { updatedAt: "asc" },
    });
    const connections = rows.map(rowToConnection);
    const waitingDomains = [
      ...new Set(
        connections.flatMap((connection) =>
          waitingDomainClaims(connection).map((claim) => claim.domain),
        ),
      ),
    ];
    if (waitingDomains.length === 0) return [];
    // THE SAME STATES `findDomainOwner` COUNTS, and it has to be the same
    // set. That read is what decides a claim is disputed — it refuses the
    // customer with "we are reviewing this" for a holder in any non-terminal
    // state — while this one builds the queue an operator reviews it FROM.
    // Filtering to ACTIVE here meant a claim held up by a VERIFIED or
    // SUSPENDED holder was refused and then never listed: the customer could
    // neither prove the domain nor get the claim decided, and no operator
    // ever saw it. One question, one answer.
    const holders = await this.prisma.ssoConnection.findMany({
      where: {
        state: { notIn: ["DISCARDED", "TORN_DOWN"] },
        verifiedDomains: { hasSome: waitingDomains },
      },
      select: { organizationId: true, verifiedDomains: true },
    });
    const verifiedElsewhere = new Map<string, string>();
    for (const holder of holders) {
      for (const domain of holder.verifiedDomains) {
        if (!waitingDomains.includes(domain)) continue;
        if (!verifiedElsewhere.has(domain)) {
          verifiedElsewhere.set(domain, holder.organizationId);
        }
      }
    }
    // The ordering, the wait and the dispute rule are the package's, so the
    // number the operator surface sorts on is the one a test enumerates.
    return disputedDomainClaimQueue({
      connections,
      nowMs: Date.now(),
      verifiedElsewhere,
    }).slice(0, limit);
  }
}

/**
 * Who a teardown would strand (ADR-117 §5). Read over the identity heads —
 * D01's `Identifier` projection — because that is where "how can this person
 * get in" is answered, and teardown must not invent a second answer.
 *
 * A user is stranded when every live identifier they hold belongs to this
 * connection. Holding one elsewhere, of any live state, is a way in that
 * survives the teardown.
 */
export class PrismaSsoConnectionStrandingRepository
  implements SsoConnectionStrandingRepository
{
  constructor(private readonly prisma: PrismaClient) {}

  async findStrandedUserIds({
    connectionId,
  }: {
    connectionId: string;
  }): Promise<string[]> {
    const held = await this.prisma.identifier.findMany({
      where: {
        connectionId,
        state: { in: [...LIVE_IDENTIFIER_STATES] },
      },
      select: { userId: true },
      distinct: ["userId"],
    });
    const userIds = held.map((row) => row.userId);
    if (userIds.length === 0) return [];

    const elsewhere = await this.prisma.identifier.findMany({
      where: {
        userId: { in: userIds },
        state: { in: [...LIVE_IDENTIFIER_STATES] },
        NOT: { connectionId },
      },
      select: { userId: true },
      distinct: ["userId"],
    });
    const covered = new Set(elsewhere.map((row) => row.userId));
    return userIds.filter((userId) => !covered.has(userId));
  }
}
