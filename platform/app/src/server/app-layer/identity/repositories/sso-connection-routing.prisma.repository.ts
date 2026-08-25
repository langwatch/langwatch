import {
  type RoutableConnection,
  routingStateOf,
  type SignInMethod,
} from "@langwatch/identity";
import type { SignInDomainRoutingPort } from "@langwatch/identity-server";
import type { PrismaClient, SsoConnection } from "~/generated/prisma/client";

/**
 * The router's domain-lookup port over the `SsoConnection` PROJECTION — what
 * `SSOCONN_ROUTING=enforce` composes, and what `shadow` compares the strings
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
  }: {
    domain: string;
  }): Promise<RoutableConnection | null> {
    // Every state, not only ACTIVE: a SUSPENDED connection still OWNS its
    // domain, and the engine's `connection_suspended` branch exists precisely
    // to say so. Filtering to ACTIVE here would make a paused connection
    // indistinguishable from a domain nobody ever configured.
    const row = await this.prisma.ssoConnection.findFirst({
      where: { verifiedDomains: { has: domain } },
      orderBy: { updatedAt: "desc" },
    });
    return row === null ? null : this.routable(row, domain);
  }

  /**
   * The self-hosted sole-connection rule's input. Only ACTIVE connections
   * here: this list answers "what could we auto-redirect to with no address
   * in hand", and a paused connection is not somewhere to send anyone.
   */
  async listActiveConnections(): Promise<readonly RoutableConnection[]> {
    const rows = await this.prisma.ssoConnection.findMany({
      where: { state: "ACTIVE" },
      orderBy: { createdAt: "asc" },
    });
    return Promise.all(rows.map((row) => this.routable(row)));
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
        row.allowsJit &&
        (domain === undefined || !row.lapsedDomains.includes(domain)),
    };
  }
}

/** The provider id the sign-in surface dials, out of the projection's
 *  `idpMetadata`. An empty string is impossible for a registered connection
 *  and would route nowhere anyway, so it degrades to "not configured". */
function providerIdOf(row: SsoConnection): string {
  const metadata = row.idpMetadata as { providerId?: unknown } | null;
  return typeof metadata?.providerId === "string" ? metadata.providerId : "";
}
