import type { RoutableConnection, SsoConnectionState } from "@langwatch/identity-contract";

import type { SsoConnectionRoutingRepository } from "../repositories/sso-connection-routing.repository.ts";
import {
  routableSsoConnectionOf,
  routableSsoConnections,
  routedSsoConnections,
  ssoRoutingMethodIdOf,
} from "../rules/sso-connection-routing.rules.ts";
import type { SsoMethodDial } from "../rules/sso-method-dial.rules.ts";
import type { SignInDomainRouting } from "./signin-router.service.ts";

/**
 * The router's domain lookup over the connection projection (D04, D09). `configured`
 * means whether a sign-in sent there would ARRIVE anywhere, which the dial decides.
 */
export class SsoConnectionRoutingService implements SignInDomainRouting {
  static create(deps: {
    connections: SsoConnectionRoutingRepository;
    dial: SsoMethodDial;
  }): SsoConnectionRoutingService {
    return new SsoConnectionRoutingService(deps.connections, deps.dial);
  }

  private constructor(
    private readonly connections: SsoConnectionRoutingRepository,
    private readonly dial: SsoMethodDial,
  ) {}

  async findConnectionsForDomain({
    domain,
  }: {
    domain: string;
  }): Promise<readonly RoutableConnection[]> {
    const routed = routedSsoConnections(await this.connections.findDomainConnections({ domain }));

    return Promise.all(routed.map((connection) => this.routable({ connection, domain })));
  }

  async findActiveConnections(): Promise<readonly RoutableConnection[]> {
    const routable = routableSsoConnections(await this.connections.findLiveConnections());

    return Promise.all(routable.map((connection) => this.routable({ connection })));
  }

  private async routable({
    connection,
    domain,
  }: {
    connection: SsoConnectionState;
    domain?: string;
  }): Promise<RoutableConnection> {
    const dial = await this.dial({
      source: connection.source,
      methodId: ssoRoutingMethodIdOf(connection),
      connectionId: connection.connectionId,
    });

    return routableSsoConnectionOf({ connection, dial, domain });
  }
}
