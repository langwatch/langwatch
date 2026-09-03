import {
  type RoutableConnection,
  routingStateOf,
  type SignInMethod,
} from "@langwatch/identity-contract";
import type { SignInDomainRoutingPort } from "../../signin-router.service";
import type { PrismaClient, SsoConnection } from "@langwatch/prisma-client/generated";

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
export class SsoConnectionDomainRoutingRepository implements SignInDomainRoutingPort {
  constructor(
    private readonly prisma: PrismaClient,
    /** Whether this deployment actually mounted a method id. Injected rather
     *  than read here so this class holds no policy — the same split the
     *  legacy repository makes. */
    private readonly isMethodConfigured: (methodId: string) => Promise<boolean>,
  ) {}

  async tryFindConnectionForDomain({
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
    return row === null ? null : this.routable(row);
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

  private async routable(row: SsoConnection): Promise<RoutableConnection> {
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
      configured: await this.isMethodConfigured(providerId),
      allowsJit: row.allowsJit,
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
