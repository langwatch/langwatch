// SPDX-License-Identifier: LicenseRef-LangWatch-Enterprise
import {
  qualifySsoDomainOwnership,
  type RoutableConnection,
  routingStateOf,
  type SignInMethod,
  type SsoConnectionSource,
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
/** The other half of a migrating pair, if this row is in one. */
function partnerOf(
  rows: SsoConnection[],
  row: SsoConnection,
): SsoConnection | undefined {
  return rows.find(
    (candidate) =>
      candidate.organizationId === row.organizationId &&
      (candidate.id === row.replacesConnectionId ||
        candidate.replacesConnectionId === row.id),
  );
}

/**
 * Which side of this row, if any, normal sign-in can be offered.
 *
 * A paired row keeps whichever side the cutover currently routes to, while
 * that side is ACTIVE or SUSPENDED — a suspended connection is still where
 * that organization's people belong. An unpaired row is kept only while
 * ACTIVE: there is no second side to fall back to.
 */
function routableSideOf(
  row: SsoConnection,
  partner: SsoConnection | undefined,
): SsoConnection | null {
  if (partner === undefined) return row.state === "ACTIVE" ? row : null;
  const routed = selectMigrationRoute([row, partner], "normal");
  if (routed === null) return null;
  return routed.state === "ACTIVE" || routed.state === "SUSPENDED"
    ? routed
    : null;
}

/**
 * One row per organization, with a migrating pair collapsed to the side normal
 * sign-in goes through.
 *
 * A pair is taken together or not at all: offering both halves would present
 * an organization mid-cutover as two separate places to sign in.
 */
function routableRows(rows: SsoConnection[]): SsoConnection[] {
  const paired = new Set<string>();
  const selected: SsoConnection[] = [];
  for (const row of rows) {
    if (paired.has(row.id)) continue;
    const partner = partnerOf(rows, row);
    if (partner !== undefined) {
      paired.add(row.id);
      paired.add(partner.id);
    }
    const side = routableSideOf(row, partner);
    if (side !== null) selected.push(side);
  }
  return selected;
}

export class SsoConnectionDomainRoutingRepository
  implements SignInDomainRoutingPort
{
  constructor(
    private readonly prisma: PrismaClient,
    /**
     * WHICH method this connection is actually dialed through, or null when
     * none is. Injected rather than read here so this class holds no policy —
     * the same split the legacy repository makes.
     *
     * It takes the CONNECTION as well as the method id because there are two
     * ways to be dialable since D09 and they are keyed differently: the
     * deployment's own mounted provider is named by method id, and an
     * organization's own registered provider is keyed by the connection. It
     * answers the id rather than a yes because a grandfathered connection's
     * `providerId` is a PIN — see `legacy-sso-dial.ts` — and the method that
     * carries it is not always the pin itself.
     */
    private readonly resolveMethodDial: (args: {
      source: SsoConnectionSource;
      methodId: string;
      connectionId: string;
      organizationId: string;
    }) => Promise<string | null>,
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
    return Promise.all(routableRows(rows).map((row) => this.routable(row)));
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
    // WHICH REGISTRY HOLDS THE PROVIDER IS WHICH ID GETS DIALED. A
    // grandfathered connection is a reference to the provider this deployment
    // mounts, and `idpMetadata.providerId` is the PIN naming it — which may
    // name an upstream behind a broker rather than the broker itself, so the
    // dial resolver has the last word on the id. A self-serve connection is
    // registered with the engine under its CONNECTION id, so that is the id
    // better-auth knows it by; dialing the customer's own label would dial a
    // provider the engine has never registered.
    const source = row.source as SsoConnectionSource;
    const methodId =
      source === "legacy-grandfathered" ? providerIdOf(row) : row.id;
    const dial = await this.resolveMethodDial({
      source,
      methodId,
      connectionId: row.id,
      organizationId: row.organizationId,
    });
    const method: SignInMethod = {
      id: dial ?? methodId,
      kind: "federated",
      connectionId: row.id,
    };
    return {
      connectionId: row.id,
      method,
      state: routingStateOf(row.state as Parameters<typeof routingStateOf>[0]),
      configured: dial !== null,
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

/** The provider NAME a connection carries in its projection `idpMetadata` —
 *  what a grandfathered connection dials, and what a self-serve one is merely
 *  labelled with. An empty string is impossible for a registered connection
 *  and would route nowhere anyway, so it degrades to "not configured". */
function providerIdOf(row: SsoConnection): string {
  const metadata = row.idpMetadata as { providerId?: unknown } | null;
  return typeof metadata?.providerId === "string" ? metadata.providerId : "";
}
