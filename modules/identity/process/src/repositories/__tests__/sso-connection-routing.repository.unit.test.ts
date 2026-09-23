import type { SsoConnection } from "@langwatch/prisma-client/generated";
import { describe, expect, it } from "vitest";

import { ssoMethodDialWith } from "../../rules/sso-method-dial.rules.ts";
import { MemoryIdentityStore } from "../memory/memory.identity.store.ts";
import { MemorySsoConnectionRoutingRepository } from "../memory/memory.sso-connection-routing.repository.ts";
import { PrismaSsoConnectionProjectionRepository } from "../prisma/prisma.sso-connection-projection.repository.ts";
import {
  type PrismaSsoConnectionRoutingDatabase,
  PrismaSsoConnectionRoutingRepository,
} from "../prisma/prisma.sso-connection-routing.repository.ts";
import type { SsoConnectionRoutingRepository } from "../sso-connection-routing.repository.ts";

/**
 * The projected domain lookup (D04, D09), one set of cases over both tiers:
 * rows are written once in the stored shape and the memory store is seeded
 * through the same translation production uses.
 */

// Spec: specs/identity/sso-idp-termination.feature

const ORG = "org_acme";
const DOMAIN = "acme.example";
const MOUNTED = "auth0";
const AT = new Date("2026-01-01T00:00:00.000Z");

const PROVED = {
  domain: DOMAIN,
  method: "dns-txt",
  actorId: "user_admin",
  verifiedAtMs: AT.getTime(),
  proofState: "VERIFIED",
  firstAbsentAtMs: null,
  graceEndsAtMs: null,
  tokenHash: "sha256:proof",
};

function row({
  id,
  source = "self-serve",
  state = "ACTIVE",
  organizationId = ORG,
  verifiedDomains = [DOMAIN],
  domainVerifications = [PROVED],
  arrivalPolicy = "admit",
  providerId = id,
  replacesConnectionId = null,
  migrationPhase = null,
  createdAt = AT,
}: {
  id: string;
  source?: string;
  state?: string;
  organizationId?: string;
  verifiedDomains?: string[];
  domainVerifications?: (typeof PROVED)[];
  arrivalPolicy?: string;
  providerId?: string;
  replacesConnectionId?: string | null;
  migrationPhase?: "SETUP" | "GRACE_LEGACY" | "GRACE_DIRECT" | "FINALIZING" | "FINALIZED" | null;
  createdAt?: Date;
}): SsoConnection {
  return {
    id,
    organizationId,
    type: "oidc",
    state,
    claimedDomains: [],
    domainClaims: [],
    approvedDomains: [],
    verifiedDomains,
    lapsedDomains: [],
    domainVerifications,
    pendingVerification: null,
    idpMetadata: { issuer: null, providerId, clientIdRef: null, secretRef: null, certRefs: [] },
    arrivalPolicy,
    allowsJit: false,
    arrivalPolicyDecidedAt: AT,
    source,
    testLoginAccountId: null,
    replacesConnectionId,
    migrationPhase,
    graceStartedAt: null,
    routeChangedAt: null,
    finalizationRequestedAt: null,
    finalizedAt: null,
    rejection: null,
    createdBy: "user_admin",
    tearDownAfter: null,
    occurredAt: AT,
    lastEventId: `event_${id}`,
    acceptedAt: AT,
    projectionVersion: "1",
    createdAt,
    updatedAt: AT,
  };
}

type Where = {
  id?: { in: string[] };
  organizationId?: string;
  source?: string;
  state?: { notIn: string[] };
  verifiedDomains?: { has: string };
  replacesConnectionId?: { in: string[] };
  OR?: Where[];
};

function matches(candidate: SsoConnection, where: Where | undefined): boolean {
  if (where === undefined) return true;
  if (where.OR !== undefined && !where.OR.some((clause) => matches(candidate, clause)))
    return false;
  if (where.id !== undefined && !where.id.in.includes(candidate.id)) return false;
  if (where.organizationId !== undefined && candidate.organizationId !== where.organizationId) {
    return false;
  }
  if (where.source !== undefined && candidate.source !== where.source) return false;
  if (where.state !== undefined && where.state.notIn.includes(candidate.state)) return false;
  if (
    where.verifiedDomains !== undefined &&
    !candidate.verifiedDomains.includes(where.verifiedDomains.has)
  ) {
    return false;
  }

  return (
    where.replacesConnectionId === undefined ||
    (candidate.replacesConnectionId !== null &&
      where.replacesConnectionId.in.includes(candidate.replacesConnectionId))
  );
}

/** The two delegates, over the rows. Ownership is held for the connections
 *  that registered themselves; a grandfathered connection predates the table
 *  and is answered by the domain column, exactly as in production. */
function stubDatabase(rows: SsoConnection[]): PrismaSsoConnectionRoutingDatabase {
  return {
    ssoConnection: {
      findFirst: async ({ where }: { where?: Where }) =>
        rows.find((candidate) => matches(candidate, where)) ?? null,
      findMany: async ({ where, orderBy }: { where?: Where; orderBy?: unknown }) => {
        const found = rows.filter((candidate) => matches(candidate, where));

        return orderBy === undefined
          ? found
          : found.toSorted((left, right) => left.createdAt.getTime() - right.createdAt.getTime());
      },
    },
    ssoVerifiedDomain: {
      findUnique: async ({ where }: { where: { domain: string } }) => {
        const holders = rows.filter(
          (candidate) =>
            candidate.source !== "legacy-grandfathered" &&
            candidate.verifiedDomains.includes(where.domain),
        );

        return holders.length === 0
          ? null
          : { holders: holders.map((holder) => ({ connectionId: holder.id })) };
      },
    },
  };
}

type Fixture = { rows: SsoConnection[]; registered?: string[] };

function dialOver(registered: readonly string[]) {
  return ssoMethodDialWith({
    mountedMethods: async () => [MOUNTED],
    engineHoldsProvider: async ({ connectionId }) => registered.includes(connectionId),
  });
}

const tiers: { name: string; build: (fixture: Fixture) => SsoConnectionRoutingRepository }[] = [
  {
    name: "memory",
    build: ({ rows, registered = [] }) => {
      const store = MemoryIdentityStore.create();
      for (const stored of rows) {
        store.ssoConnections.set(
          stored.id,
          PrismaSsoConnectionProjectionRepository.rowToConnection(stored),
        );
      }

      return MemorySsoConnectionRoutingRepository.create({ store, dial: dialOver(registered) });
    },
  },
  {
    name: "prisma",
    build: ({ rows, registered = [] }) =>
      PrismaSsoConnectionRoutingRepository.create({
        database: stubDatabase(rows),
        dial: dialOver(registered),
      }),
  },
];

describe.each(tiers)("SSO connection routing ($name)", ({ build }) => {
  describe("findConnectionsForDomain()", () => {
    /** @scenario "A live connection decides the domains it proved" */
    it("answers the connection that proved the domain", async () => {
      const routing = build({ rows: [row({ id: "ssoc_acme" })], registered: ["ssoc_acme"] });

      await expect(routing.findConnectionsForDomain({ domain: DOMAIN })).resolves.toEqual([
        {
          connectionId: "ssoc_acme",
          method: { id: "ssoc_acme", kind: "federated", connectionId: "ssoc_acme" },
          state: "ACTIVE",
          configured: true,
          allowsJit: true,
        },
      ]);
    });

    it("answers nothing for a domain no connection proved", async () => {
      const routing = build({ rows: [row({ id: "ssoc_acme" })], registered: ["ssoc_acme"] });

      await expect(routing.findConnectionsForDomain({ domain: "globex.example" })).resolves.toEqual(
        [],
      );
    });

    it("answers a paused connection as paused rather than as absent", async () => {
      const routing = build({
        rows: [row({ id: "ssoc_acme", state: "SUSPENDED" })],
        registered: ["ssoc_acme"],
      });

      const [routed] = await routing.findConnectionsForDomain({ domain: DOMAIN });

      expect(routed?.state).toBe("SUSPENDED");
    });

    /** @scenario "A connection the engine has never heard of still refuses to route" */
    it("answers a connection the engine holds no provider for as unconfigured", async () => {
      const routing = build({ rows: [row({ id: "ssoc_acme" })] });

      const [routed] = await routing.findConnectionsForDomain({ domain: DOMAIN });

      expect(routed).toMatchObject({ configured: false, method: { id: "ssoc_acme" } });
    });

    it("dials a grandfathered connection through the method this deployment mounts", async () => {
      const routing = build({
        rows: [
          row({ id: "local_ssoc_acme", source: "legacy-grandfathered", providerId: "waad|acme" }),
        ],
      });

      const [routed] = await routing.findConnectionsForDomain({ domain: DOMAIN });

      expect(routed).toMatchObject({ configured: true, method: { id: MOUNTED } });
    });

    it("provisions nobody on a domain whose proof lapsed", async () => {
      const routing = build({
        rows: [
          row({
            id: "ssoc_acme",
            domainVerifications: [{ ...PROVED, proofState: "LAPSED" }],
          }),
        ],
        registered: ["ssoc_acme"],
      });

      const [routed] = await routing.findConnectionsForDomain({ domain: DOMAIN });

      expect(routed).toMatchObject({ state: "ACTIVE", allowsJit: false });
    });

    it("provisions nobody through a connection that admits nobody", async () => {
      const routing = build({
        rows: [row({ id: "ssoc_acme", arrivalPolicy: "refuse" })],
        registered: ["ssoc_acme"],
      });

      const [routed] = await routing.findConnectionsForDomain({ domain: DOMAIN });

      expect(routed?.allowsJit).toBe(false);
    });
  });

  describe("given a migration pair", () => {
    const pair = (
      migrationPhase: "SETUP" | "GRACE_LEGACY" | "GRACE_DIRECT" | "FINALIZING" | "FINALIZED",
    ): SsoConnection[] => [
      row({ id: "local_ssoc_acme", source: "legacy-grandfathered", providerId: MOUNTED }),
      row({ id: "ssoc_acme", replacesConnectionId: "local_ssoc_acme", migrationPhase }),
    ];

    it.each(["SETUP", "GRACE_LEGACY"] as const)(
      "keeps the grandfathered side while the cutover is %s",
      async (migrationPhase) => {
        const routing = build({ rows: pair(migrationPhase), registered: ["ssoc_acme"] });

        const [routed] = await routing.findConnectionsForDomain({ domain: DOMAIN });

        expect(routed?.connectionId).toBe("local_ssoc_acme");
      },
    );

    it.each(["GRACE_DIRECT", "FINALIZING", "FINALIZED"] as const)(
      "sends sign-in to the replacement once the cutover is %s",
      async (migrationPhase) => {
        const routing = build({ rows: pair(migrationPhase), registered: ["ssoc_acme"] });

        const [routed] = await routing.findConnectionsForDomain({ domain: DOMAIN });

        expect(routed?.connectionId).toBe("ssoc_acme");
      },
    );
  });

  describe("findActiveConnections()", () => {
    it("offers a migrating organization once, not once per side", async () => {
      const routing = build({
        rows: [
          row({ id: "local_ssoc_acme", source: "legacy-grandfathered", providerId: MOUNTED }),
          row({
            id: "ssoc_acme",
            replacesConnectionId: "local_ssoc_acme",
            migrationPhase: "GRACE_DIRECT",
          }),
        ],
        registered: ["ssoc_acme"],
      });

      const offered = await routing.findActiveConnections();

      expect(offered.map((connection) => connection.connectionId)).toEqual(["ssoc_acme"]);
    });

    it("leaves out a connection that is not serving traffic", async () => {
      const routing = build({
        rows: [
          row({ id: "ssoc_acme", state: "SUSPENDED" }),
          row({ id: "ssoc_globex", organizationId: "org_globex", verifiedDomains: [] }),
        ],
        registered: ["ssoc_acme", "ssoc_globex"],
      });

      const offered = await routing.findActiveConnections();

      expect(offered.map((connection) => connection.connectionId)).toEqual(["ssoc_globex"]);
    });

    it("provisions nobody through a connection reached with no address in hand", async () => {
      const routing = build({ rows: [row({ id: "ssoc_acme" })], registered: ["ssoc_acme"] });

      const offered = await routing.findActiveConnections();

      expect(offered[0]).toMatchObject({ allowsJit: true, configured: true });
    });
  });
});
