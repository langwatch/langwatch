import {
  qualifySsoDomainOwnership,
  type RoutableConnection,
  routingStateOf,
  type SignInMethod,
} from "@langwatch/identity";
import type { SignInDomainRoutingPort } from "@langwatch/identity-server";
import type { PrismaClient, SsoConnection } from "~/generated/prisma/client";
import { rowToConnection } from "./sso-connection-projection.prisma.repository";

/**
 * The router's domain-lookup port over the `SsoConnection` PROJECTION — what
 * the connection-first lookup asks first, before it falls back to the strings
 * against (ADR-117 §5).
 *
 * The same port the legacy strings implement, so neither the router nor the
 * engine learns which side of the flip it is on: the swap is a line in
 * `runtime.ts`. What it answers that the strings cannot is real lifecycle —
 * a SUSPENDED connection comes back SUSPENDED rather than absent, which is
 * what lets the picker say "your organization has paused this" instead of
 * silently offering a password form.
 */
export class SsoConnectionDomainRoutingRepository
  implements SignInDomainRoutingPort
{
  constructor(
    private readonly prisma: PrismaClient,
    /**
     * Whether this connection can actually be dialed. Injected rather than
     * read here so this class holds no policy — the same split the legacy
     * repository makes.
     *
     * It takes the CONNECTION as well as the method id because there are two
     * ways to be configured since D09 and they are keyed differently: the
     * deployment's own mounted provider is named by method id, and an
     * organization's own registered provider is keyed by the connection.
     */
    private readonly isMethodConfigured: (args: {
      methodId: string;
      connectionId: string;
      organizationId: string;
    }) => Promise<boolean>,
  ) {}

  async findConnectionForDomain({
    domain,
    route = "normal",
  }: {
    domain: string;
    route?: "normal" | "replacement";
  }): Promise<RoutableConnection | null> {
    // Every state, not only ACTIVE: a SUSPENDED connection still OWNS its
    // domain, and the engine's `connection_suspended` branch exists precisely
    // to say so. Filtering to ACTIVE here would make a paused connection
    // indistinguishable from a domain nobody ever configured.
    const ownership = await this.prisma.ssoVerifiedDomain.findUnique({
      where: { domain },
      select: { holders: { select: { connectionId: true } } },
    });
    if (ownership === null) {
      const legacy = await this.prisma.ssoConnection.findFirst({
        where: {
          source: "legacy-grandfathered",
          state: { notIn: ["DISCARDED", "TORN_DOWN"] },
          verifiedDomains: { has: domain },
        },
      });
      return legacy === null ? null : this.routable(legacy, domain);
    }
    const holderIds = ownership.holders.map((holder) => holder.connectionId);
    const holders = await this.prisma.ssoConnection.findMany({
      where: { id: { in: holderIds } },
    });
    const organizationId = holders[0]?.organizationId;
    const rows =
      organizationId === undefined
        ? []
        : await this.prisma.ssoConnection.findMany({
            where: {
              organizationId,
              OR: [
                { id: { in: holderIds } },
                { replacesConnectionId: { in: holderIds } },
                {
                  id: {
                    in: holders.flatMap((holder) =>
                      holder.replacesConnectionId
                        ? [holder.replacesConnectionId]
                        : [],
                    ),
                  },
                },
              ],
            },
          });
    const row = selectMigrationRoute(rows, route);
    return row === null ? null : this.routable(row, domain);
  }

  /**
   * The self-hosted sole-connection rule's input. Only ACTIVE connections
   * here: this list answers "what could we auto-redirect to with no address
   * in hand", and a paused connection is not somewhere to send anyone.
   */
  async listActiveConnections(): Promise<readonly RoutableConnection[]> {
    const rows = await this.prisma.ssoConnection.findMany({
      where: { state: { notIn: ["DISCARDED", "TORN_DOWN"] } },
      orderBy: { createdAt: "asc" },
    });
    const paired = new Set<string>();
    const selected: SsoConnection[] = [];
    for (const row of rows) {
      if (paired.has(row.id)) continue;
      const partner = rows.find(
        (candidate) =>
          candidate.organizationId === row.organizationId &&
          (candidate.id === row.replacesConnectionId ||
            candidate.replacesConnectionId === row.id),
      );
      if (partner === undefined) {
        if (row.state === "ACTIVE") selected.push(row);
        continue;
      }
      paired.add(row.id);
      paired.add(partner.id);
      const routed = selectMigrationRoute([row, partner], "normal");
      if (
        routed !== null &&
        (routed.state === "ACTIVE" || routed.state === "SUSPENDED")
      ) {
        selected.push(routed);
      }
    }
    return Promise.all(selected.map((row) => this.routable(row)));
  }

  /**
   * One stored row as routing sees it.
   *
   * `domain` is passed when the lookup HAD one, and it is the whole of how a
   * lapse reaches sign-in (ADR-123): a domain whose published record stayed
   * missing through its grace still routes — the door opens, the state is
   * unchanged, every person who already works there signs in exactly as
   * before — and it stops PROVISIONING. That is the entire behavioural
   * difference, and it is expressed here as `allowsJit` turning false for
   * that domain rather than as anything routing would notice.
   *
   * The domainless caller is the self-hosted sole-connection redirect, which
   * runs with no address in hand and therefore never provisions anybody: it
   * has no domain to judge and needs none.
   */
  private async routable(
    row: SsoConnection,
    domain?: string,
  ): Promise<RoutableConnection> {
    const providerId = providerIdOf(row);
    const method: SignInMethod = {
      id: providerId,
      kind: "federated",
      connectionId: row.id,
    };
    return {
      connectionId: row.id,
      method,
      state: routingStateOf(row.state as Parameters<typeof routingStateOf>[0]),
      configured: await this.isMethodConfigured({
        methodId: providerId,
        connectionId: row.id,
        organizationId: row.organizationId,
      }),
      allowsJit:
        row.arrivalPolicy !== "refuse" &&
        (domain === undefined ||
          qualifySsoDomainOwnership({
            state: rowToConnection(row),
            domain,
          }).status === "QUALIFIED"),
    };
  }
}

/**
 * Pick one side of a grandfathered/direct pair from persisted migration
 * state. Timestamps are deliberately absent: replaying the same facts must
 * select the same provider even if projection rows were touched in a
 * different order.
 */
export function selectMigrationRoute(
  rows: readonly SsoConnection[],
  route: "normal" | "replacement",
): SsoConnection | null {
  if (rows.length === 0) return null;
  if (rows.length === 1) return rows[0]!;

  const replacement = rows.find((row) =>
    rows.some((candidate) => candidate.id === row.replacesConnectionId),
  );
  if (replacement === undefined) {
    throw new Error("sso_domain_holders_are_not_a_replacement_pair");
  }
  const predecessor = rows.find(
    (row) => row.id === replacement.replacesConnectionId,
  );
  if (
    predecessor === undefined ||
    predecessor.organizationId !== replacement.organizationId ||
    rows.length !== 2
  ) {
    throw new Error("sso_domain_holders_are_not_a_replacement_pair");
  }
  if (route === "replacement") return replacement;

  switch (replacement.migrationPhase) {
    case "GRACE_DIRECT":
    case "FINALIZING":
    case "FINALIZED":
      return replacement;
    case "SETUP":
    case "GRACE_LEGACY":
    case null:
      return predecessor;
  }
}

/** The provider id the sign-in surface dials, out of the projection's
 *  `idpMetadata`. An empty string is impossible for a registered connection
 *  and would route nowhere anyway, so it degrades to "not configured". */
function providerIdOf(row: SsoConnection): string {
  const metadata = row.idpMetadata as { providerId?: unknown } | null;
  return typeof metadata?.providerId === "string" ? metadata.providerId : "";
}
