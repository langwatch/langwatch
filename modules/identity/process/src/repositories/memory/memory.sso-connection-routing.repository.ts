import type { RoutableConnection, SsoConnectionState } from "@langwatch/identity-contract";

import {
  routableSsoConnectionOf,
  routableSsoConnections,
  routedSsoConnections,
  ssoRoutingMethodIdOf,
} from "../../rules/sso-connection-routing.rules.ts";
import type { SsoMethodDial } from "../../rules/sso-method-dial.rules.ts";
import { SsoConnectionRoutingRepository } from "../sso-connection-routing.repository.ts";
import type { MemoryIdentityStore } from "./memory.identity.store.ts";

/** A connection nobody may be sent to any more. */
const GONE = new Set(["DISCARDED", "TORN_DOWN"]);

/** The routing twin, over the folded connections the store keeps. Ownership
 *  of a domain is read off `verifiedDomains`: the live tier's holder table is
 *  an index of that same fact, and the grandfathered rows it does not carry
 *  are this one scan here. */
export class MemorySsoConnectionRoutingRepository extends SsoConnectionRoutingRepository {
  static create({
    store,
    dial,
  }: {
    store: MemoryIdentityStore;
    dial: SsoMethodDial;
  }): MemorySsoConnectionRoutingRepository {
    return new MemorySsoConnectionRoutingRepository(store, dial);
  }

  private constructor(
    private readonly store: MemoryIdentityStore,
    private readonly dial: SsoMethodDial,
  ) {
    super();
  }

  async findConnectionsForDomain({
    domain,
  }: {
    domain: string;
  }): Promise<readonly RoutableConnection[]> {
    // Every state but the terminal ones: a SUSPENDED connection still owns
    // its domain, and answering absent would read as never configured.
    const holders = this.live().filter((connection) => connection.verifiedDomains.includes(domain));
    const organizationId = holders[0]?.organizationId;
    if (organizationId === undefined) return [];

    const routed = routedSsoConnections(this.pairedWith({ holders, organizationId }));

    return Promise.all(routed.map((connection) => this.routable(connection, domain)));
  }

  async findActiveConnections(): Promise<readonly RoutableConnection[]> {
    const ordered = this.live().toSorted((left, right) => left.createdAtMs - right.createdAtMs);

    return Promise.all(
      routableSsoConnections(ordered).map((connection) => this.routable(connection)),
    );
  }

  private live(): SsoConnectionState[] {
    return [...this.store.ssoConnections.values()].filter(
      (connection) => !GONE.has(connection.state),
    );
  }

  /** The holders plus whichever half of a replacement pair they are in. */
  private pairedWith({
    holders,
    organizationId,
  }: {
    holders: readonly SsoConnectionState[];
    organizationId: string;
  }): SsoConnectionState[] {
    const holderIds = new Set(holders.map((holder) => holder.connectionId));

    return [...this.store.ssoConnections.values()].filter(
      (connection) =>
        connection.organizationId === organizationId &&
        (holderIds.has(connection.connectionId) ||
          (connection.replacesConnectionId !== null &&
            holderIds.has(connection.replacesConnectionId)) ||
          holders.some((holder) => holder.replacesConnectionId === connection.connectionId)),
    );
  }

  private async routable(
    connection: SsoConnectionState,
    domain?: string,
  ): Promise<RoutableConnection> {
    const dial = await this.dial({
      source: connection.source,
      methodId: ssoRoutingMethodIdOf(connection),
      connectionId: connection.connectionId,
    });

    return routableSsoConnectionOf({ connection, dial, domain });
  }
}
