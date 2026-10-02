import type { RoutableConnection, SignInMethod } from "@langwatch/identity-contract";

import type { LegacySsoOrganizationRepository } from "../repositories/legacy-sso-organization.repository.ts";
import { legacySsoDialOf } from "../rules/legacy-sso-dial.rules.ts";
import type { SignInDomainRouting, SignInLegacyDomainRouting } from "./signin-router.service.ts";

/**
 * The router's legacy domain lookup over `Organization.ssoDomain` / `ssoProvider` (ADR-117 §1,
 * §5): what routes an organization no projected connection answers for yet.
 */
export class LegacySsoDomainRoutingService
  implements SignInDomainRouting, SignInLegacyDomainRouting
{
  static create(deps: {
    organizations: Pick<LegacySsoOrganizationRepository, "findByDomain">;
    /** The federated methods this deployment mounts: none in email mode, else its one. */
    mountedMethods: () => Promise<readonly SignInMethod[]>;
  }): LegacySsoDomainRoutingService {
    return new LegacySsoDomainRoutingService(deps.organizations, deps.mountedMethods);
  }

  private constructor(
    private readonly organizations: Pick<LegacySsoOrganizationRepository, "findByDomain">,
    private readonly mountedMethods: () => Promise<readonly SignInMethod[]>,
  ) {}

  async findConnectionsForDomain({
    domain,
  }: {
    domain: string;
  }): Promise<readonly RoutableConnection[]> {
    const organization = await this.organizations.findByDomain({ domain });
    if (!organization?.ssoProvider) return [];

    // The pin is not always dialable itself: `legacySsoDialOf` reads which mounted method
    // carries it, and where none does the connection is unconfigured rather than misrouted.
    const [mounted] = await this.mountedMethods();
    const dial = legacySsoDialOf({
      pin: organization.ssoProvider,
      mountedMethodId: mounted?.id ?? null,
    });
    const connectionId = `org:${organization.id}`;
    return [
      {
        connectionId,
        method: {
          id: dial.dialable ? dial.methodId : organization.ssoProvider,
          kind: "federated",
          connectionId,
        },
        state: "ACTIVE",
        configured: dial.dialable,
        allowsJit: true,
      },
    ];
  }

  async findActiveConnections(): Promise<readonly RoutableConnection[]> {
    const mounted = await this.mountedMethods();
    return mounted.map((method) => ({
      connectionId: `env:${method.id}`,
      method: { ...method, connectionId: `env:${method.id}` },
      state: "ACTIVE",
      configured: true,
      allowsJit: true,
    }));
  }

  async findLegacyConnectionForDomain({
    domain,
  }: {
    domain: string;
  }): Promise<RoutableConnection | null> {
    const [connection] = await this.findConnectionsForDomain({ domain });
    return connection ?? null;
  }

  findLegacyActiveConnections(): Promise<readonly RoutableConnection[]> {
    return this.findActiveConnections();
  }
}
