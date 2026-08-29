import type { SignInMethod } from "@langwatch/identity-contract";
import type { SsoConnectionLedger } from "@langwatch/identity-server";
import {
  SsoConnectionGrandfatherService,
  SsoConnectionGuards,
  SsoConnectionService,
} from "@langwatch/identity-server";
import { nanoid } from "nanoid";
import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "~/server/db";
import { createTenantId } from "@langwatch/eventing";
import {
  type SsoConnectionFoldState,
  SsoConnectionStateFoldProjection,
  ssoConnectionEventsFor,
} from "@langwatch/identity-eventing";
import { LocalDoorBreakGlassBinding } from "../../break-glass-binding";
import { AdminEmailPlatformOperators } from "../../platform-operators";
import { LegacySsoDomainRoutingRepository } from "../legacy-sso-domain.prisma.repository";
import { PrismaLegacySsoOrganizationRepository } from "../legacy-sso-organization.prisma.repository";
import { PrismaSsoConnectionProjectionRepository } from "../sso-connection-projection.prisma.repository";
import {
  PrismaSsoConnectionReadRepository,
  PrismaSsoConnectionStrandingRepository,
} from "../sso-connection-reads.prisma.repository";
import { SsoConnectionDomainRoutingRepository } from "../sso-connection-routing.prisma.repository";

/**
 * The grandfather pass against real Postgres (ADR-117 §5): an organization
 * that has been signing in through `Organization.ssoDomain` for years gets a
 * connection whose history says so, and the pass only finalizes when the
 * connection-based routing decision matches the string-based one for every
 * domain it carries.
 *
 * Everything here is real except the LEDGER, which folds through the real
 * projection store instead of appending to ClickHouse and waiting for the
 * queue. That substitution is the point of the seam: what this test is about
 * is the pass, the projection and the routing proof — the append and the
 * convergence wait are the identity ledger's shape, already covered where
 * they live.
 */

const namespace = `ssogf-${nanoid(8)}`;
const ORG = `${namespace}-org`;
// Lowercase on purpose: the legacy column is matched byte-for-byte by the
// string lookup, and a connection normalizes what it verifies. A domain the
// two would fold differently is a real bug, not a fixture detail — the
// backoffice lowercases on write for exactly this reason.
const DOMAIN = `${namespace.toLowerCase()}.example.com`;
const PROVIDER = "okta";

const projectionStore = new PrismaSsoConnectionProjectionRepository(prisma);
const foldProjection = new SsoConnectionStateFoldProjection({
  store: projectionStore,
});

/** The instance mounts the provider the organization names — the ordinary
 *  case, and the one where both lookups must agree. */
const mountedMethod = async (): Promise<SignInMethod | null> => ({
  id: PROVIDER,
  kind: "federated",
  connectionId: null,
});

const legacyRouting = new LegacySsoDomainRoutingRepository(
  prisma,
  mountedMethod,
);
const connectionRouting = new SsoConnectionDomainRoutingRepository(
  prisma,
  async (methodId) => methodId === PROVIDER,
);

let appended = 0;

/** Folds what the guard states straight into the real projection store, in
 *  the per-connection order the queue would. */
const ledger: SsoConnectionLedger = {
  async commit({ command, facts }) {
    // The REAL envelope, so the events the fold sees here are stamped exactly
    // as the ledger writer would stamp them — aggregate type included, which
    // is what the projection's wire schema validates.
    const events = ssoConnectionEventsFor({ command, facts });
    if (events.length === 0) return [];
    const { connectionId, tenantId, occurredAtMs } = command.data;
    const context = {
      aggregateId: connectionId,
      tenantId: createTenantId(tenantId),
    };
    const loaded = await projectionStore.tryLoad(connectionId, context);
    let state: SsoConnectionFoldState =
      loaded?.state ??
      ({
        ...(
          foldProjection as unknown as {
            initState: () => Omit<
              SsoConnectionFoldState,
              "CreatedAt" | "UpdatedAt" | "LastEventOccurredAt"
            >;
          }
        ).initState(),
        CreatedAt: occurredAtMs,
        UpdatedAt: occurredAtMs,
        LastEventOccurredAt: 0,
      } as SsoConnectionFoldState);

    for (const event of events) {
      appended += 1;
      state = foldProjection.apply(state, event);
    }

    const last = events[events.length - 1]!;
    await projectionStore.store(
      {
        state,
        cursor: { acceptedAt: last.createdAt, eventId: last.id },
        occurredAt: last.occurredAt,
        createdAt: events[0]!.occurredAt,
        updatedAt: last.occurredAt,
        version: foldProjection.version,
      },
      context,
    );
    return events as never;
  },
};

function grandfather() {
  return new SsoConnectionGrandfatherService({
    connections: new SsoConnectionService(
      new SsoConnectionGuards({
        connections: new PrismaSsoConnectionReadRepository(prisma),
        breakGlass: new LocalDoorBreakGlassBinding(),
        stranding: new PrismaSsoConnectionStrandingRepository(prisma),
        // The real binding, over the same prisma the rest of this suite uses:
        // an integration test that stubbed the operator check would stop
        // proving the guard it is here to exercise.
        platformOperators: new AdminEmailPlatformOperators(prisma),
      }),
      ledger,
    ),
    legacy: new PrismaLegacySsoOrganizationRepository(prisma),
    legacyRouting,
    connectionRouting,
    idpMetadataFor: ({ ssoProvider }) => ({
      issuer: null,
      providerId: ssoProvider,
      clientIdRef: null,
      secretRef: null,
      certRefs: [],
    }),
  });
}

async function withLegacySsoOrganization() {
  await prisma.organization.upsert({
    where: { id: ORG },
    create: {
      id: ORG,
      name: "Acme",
      slug: namespace,
      ssoDomain: DOMAIN,
      ssoProvider: PROVIDER,
    },
    update: { ssoDomain: DOMAIN, ssoProvider: PROVIDER },
  });
}

afterEach(async () => {
  await prisma.ssoConnection.deleteMany({ where: { organizationId: ORG } });
  await prisma.organization.deleteMany({ where: { id: ORG } });
  appended = 0;
});

describe("the sso connection grandfather migration against Postgres", () => {
  describe("given an organization carrying legacy ssoDomain and ssoProvider", () => {
    /** @scenario "A legacy SSO organization is grandfathered without noticing" */
    it("produces a VERIFIED and ACTIVE connection marked legacy-grandfathered", async () => {
      await withLegacySsoOrganization();

      const outcome = await grandfather().migrateOrganization({
        organizationId: ORG,
      });

      expect(outcome.status).toBe("finalized");
      const rows = await prisma.ssoConnection.findMany({
        where: { organizationId: ORG },
      });
      expect(rows).toHaveLength(1);
      expect(rows[0]).toMatchObject({
        state: "ACTIVE",
        source: "legacy-grandfathered",
        type: "oidc",
        verifiedDomains: [DOMAIN],
        allowsJit: true,
      });
      // The domain went through the whole ceremony as history: claimed,
      // approved, verified — not injected straight into ACTIVE.
      expect(rows[0]?.claimedDomains).toEqual([]);
      expect(rows[0]?.approvedDomains).toEqual([]);
      expect(rows[0]?.idpMetadata).toMatchObject({ providerId: PROVIDER });
    });

    /** @scenario "A legacy SSO organization is grandfathered without noticing" */
    it("leaves the organization's users signing in exactly as before", async () => {
      await withLegacySsoOrganization();

      await grandfather().migrateOrganization({ organizationId: ORG });

      // The strings are untouched, so the live path is byte-for-byte what it
      // was: this slice stops no write and flips no flag.
      const organization = await prisma.organization.findUnique({
        where: { id: ORG },
        select: { ssoDomain: true, ssoProvider: true },
      });
      expect(organization).toEqual({
        ssoDomain: DOMAIN,
        ssoProvider: PROVIDER,
      });

      // And both lookups now answer the same routing decision for the
      // domain, which is what "without noticing" has to mean.
      const [strings, connection] = await Promise.all([
        legacyRouting.findConnectionForDomain({ domain: DOMAIN }),
        connectionRouting.findConnectionForDomain({ domain: DOMAIN }),
      ]);
      expect(connection).toMatchObject({
        state: "ACTIVE",
        configured: true,
        allowsJit: strings?.allowsJit,
      });
      expect(connection?.method.id).toBe(strings?.method.id);
    });

    /** @scenario "The grandfather migration is idempotent per organization" */
    it("appends nothing on a second pass and leaves exactly one connection", async () => {
      await withLegacySsoOrganization();

      await grandfather().migrateOrganization({ organizationId: ORG });
      const afterFirst = appended;
      expect(afterFirst).toBeGreaterThan(0);

      const second = await grandfather().migrateOrganization({
        organizationId: ORG,
      });

      expect(appended).toBe(afterFirst);
      expect(second.status).toBe("finalized");
      expect(
        await prisma.ssoConnection.count({ where: { organizationId: ORG } }),
      ).toBe(1);
    });

    /** @scenario "A grandfathered organization finalizes on routing agreement" */
    it("holds the organization when the deployment never mounted the provider", async () => {
      await withLegacySsoOrganization();
      const unmounted = new SsoConnectionGrandfatherService({
        connections: new SsoConnectionService(
          new SsoConnectionGuards({
            connections: new PrismaSsoConnectionReadRepository(prisma),
            breakGlass: new LocalDoorBreakGlassBinding(),
            stranding: new PrismaSsoConnectionStrandingRepository(prisma),
            // The real binding, over the same prisma the rest of this suite uses:
            // an integration test that stubbed the operator check would stop
            // proving the guard it is here to exercise.
            platformOperators: new AdminEmailPlatformOperators(prisma),
          }),
          ledger,
        ),
        legacy: new PrismaLegacySsoOrganizationRepository(prisma),
        // The strings say the org's provider is mounted; the projection port
        // is told it is not. A real disagreement, and one a person would feel.
        legacyRouting,
        connectionRouting: new SsoConnectionDomainRoutingRepository(
          prisma,
          async () => false,
        ),
        idpMetadataFor: ({ ssoProvider }) => ({
          issuer: null,
          providerId: ssoProvider,
          clientIdRef: null,
          secretRef: null,
          certRefs: [],
        }),
      });

      const outcome = await unmounted.migrateOrganization({
        organizationId: ORG,
      });

      expect(outcome.status).toBe("migrated");
      expect(outcome.report).toMatchObject({ kind: "routing_disagreement" });
      const report = outcome.report as { disagreements: { domain: string }[] };
      expect(report.disagreements.map((entry) => entry.domain)).toEqual([
        DOMAIN,
      ]);
    });

    /** @scenario "The projection replays whole-row like every identity projection" */
    it("round-trips the whole row back through the store", async () => {
      await withLegacySsoOrganization();
      await grandfather().migrateOrganization({ organizationId: ORG });

      const connectionId = `ssoc_gf_${ORG}`;
      const context = {
        aggregateId: connectionId,
        tenantId: createTenantId(ORG),
      };
      const loaded = await projectionStore.tryLoad(connectionId, context);

      // Store it again unchanged and read it back: a column the mapping
      // loses, or one the database writes from its own clock, would come back
      // different — which is the failure a replay would otherwise introduce
      // silently. Every column here is event-derived, so it does not.
      await projectionStore.store(loaded!, context);
      const reloaded = await projectionStore.tryLoad(connectionId, context);

      expect(reloaded).toEqual(loaded);
    });
  });

  describe("given an organization with no legacy SSO at all", () => {
    /** @scenario "A legacy SSO organization is grandfathered without noticing" */
    it("finalizes without creating a connection", async () => {
      await prisma.organization.upsert({
        where: { id: ORG },
        create: { id: ORG, name: "Acme", slug: namespace },
        update: { ssoDomain: null, ssoProvider: null },
      });

      const outcome = await grandfather().migrateOrganization({
        organizationId: ORG,
      });

      expect(outcome).toEqual({
        status: "finalized",
        report: { kind: "no_legacy_sso" },
      });
      expect(
        await prisma.ssoConnection.count({ where: { organizationId: ORG } }),
      ).toBe(0);
    });
  });
});
