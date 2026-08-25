import type { RoutableConnection } from "@langwatch/identity";
import type { SignInDomainRoutingPort } from "@langwatch/identity-server";

/**
 * Which of the two domain lookups decides a sign-in, ONE ORGANIZATION AT A
 * TIME (D09 — see specs/identity/sso-idp-termination.feature).
 *
 * D04 shipped the flip as `SSOCONN_ROUTING`, an environment variable, and an
 * environment variable is a fleet-wide decision. The decision this actually
 * is is per-customer: the first organization to route through a connection it
 * registered itself has to be able to, without every other organization on
 * the deployment moving with it — and without any of them being able to tell.
 *
 * So the projection is consulted FIRST and its answer is then asked to
 * justify itself: a connection is only allowed to decide when its own
 * organization has the flag. With the flag off — the default, and every
 * existing organization — the legacy columns answer exactly as they did
 * before this class existed, and the projection read is a wasted query rather
 * than a behavior change.
 *
 * The order matters and is not the obvious one. The flag is per
 * ORGANIZATION and the lookup is by DOMAIN, so there is no organization to
 * check the flag for until the projection has found one. Checking the legacy
 * side first would mean an organization on the flag still being answered by
 * its stale string columns whenever they happened to hold something.
 */
export class PerOrganizationDomainRoutingRepository
  implements SignInDomainRoutingPort
{
  constructor(
    private readonly deps: {
      legacy: SignInDomainRoutingPort;
      connections: SignInDomainRoutingPort;
      /** Whether this organization's own connections decide its sign-in. */
      routesOffConnections: (args: {
        organizationId: string;
      }) => Promise<boolean>;
      /** The organization a connection belongs to. The routing port answers
       *  a `RoutableConnection`, which deliberately carries no tenant — it is
       *  what the ROUTER sees, and the router has no business knowing — so
       *  the tenant is looked up here. */
      organizationOf: (args: {
        connectionId: string;
      }) => Promise<string | null>;
    },
  ) {}

  async findConnectionForDomain({
    domain,
  }: {
    domain: string;
  }): Promise<RoutableConnection | null> {
    const projected = await this.deps.connections.findConnectionForDomain({
      domain,
    });
    if (projected !== null && (await this.enrolled(projected))) {
      return projected;
    }
    return this.deps.legacy.findConnectionForDomain({ domain });
  }

  /**
   * The self-hosted sole-connection rule's input.
   *
   * Union rather than either-or, and deliberately: this list answers "is
   * there exactly one place everybody here signs in", and an installation
   * mid-rollout has one connection whichever side it is currently listed
   * from. Answering only the legacy side would make a registered connection
   * invisible to the rule; answering only the projection would make an
   * unenrolled one disappear from it. Duplicates are removed by connection
   * id, so an organization listed on both sides still counts once.
   */
  async listActiveConnections(): Promise<readonly RoutableConnection[]> {
    const [legacy, projected] = await Promise.all([
      this.deps.legacy.listActiveConnections(),
      this.deps.connections.listActiveConnections(),
    ]);
    const enrolled: RoutableConnection[] = [];
    for (const connection of projected) {
      if (await this.enrolled(connection)) enrolled.push(connection);
    }
    const seen = new Set(enrolled.map((one) => one.connectionId));
    return [
      ...enrolled,
      ...legacy.filter((one) => !seen.has(one.connectionId)),
    ];
  }

  private async enrolled(connection: RoutableConnection): Promise<boolean> {
    const organizationId = await this.deps.organizationOf({
      connectionId: connection.connectionId,
    });
    if (organizationId === null) return false;
    return this.deps.routesOffConnections({ organizationId });
  }
}
