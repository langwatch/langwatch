import type { RoutableConnection } from "@langwatch/identity";
import { beforeEach, describe, expect, it } from "vitest";
import type { SignInDomainRoutingPort } from "../signin-router.service";
import { SsoConnectionGrandfatherService } from "../sso-connection-grandfather.service";
import { SsoConnectionGuards } from "../sso-connection-guards";
import type { SsoConnectionLedger } from "../sso-connection-ledger";
import { SsoConnectionService } from "../sso-connection.service";
import {
  InMemoryConnections,
  StubBreakGlassBindings,
  StubLicenseAuthority,
  StubPlatformOperators,
  StubStranding,
} from "./support/in-memory-connections";

const ORG = "org_acme";
const T0 = 1_756_000_000_000;

const IDP = {
  issuer: null,
  providerId: "okta",
  clientIdRef: null,
  secretRef: null,
  certRefs: [] as string[],
};

/** A routing answer, in the shape both ports produce. */
function routable(
  overrides: Partial<RoutableConnection> & { connectionId: string },
): RoutableConnection {
  return {
    method: {
      id: "okta",
      kind: "federated",
      connectionId: overrides.connectionId,
    },
    state: "ACTIVE",
    configured: true,
    arrivalPolicy: "admit",
    ...overrides,
  };
}

class StubRouting implements SignInDomainRoutingPort {
  constructor(
    private readonly byDomain: Record<string, RoutableConnection | null>,
  ) {}

  async findConnectionForDomain({ domain }: { domain: string }) {
    return this.byDomain[domain] ?? null;
  }

  async listActiveConnections() {
    return [];
  }
}

let connections: InMemoryConnections;
let ledger: SsoConnectionLedger;

/** The ledger the calling path would use, folded in memory: it applies what
 *  the guard stated so the next read sees it, which is the read-your-writes
 *  behaviour the real writer's convergence wait provides. */
function inMemoryLedger(store: InMemoryConnections): SsoConnectionLedger {
  return {
    async commit({ command, facts }) {
      store.apply({
        connectionId: command.data.connectionId,
        facts,
        occurredAt: command.data.occurredAtMs,
      });
      return facts.map((fact) => ({
        ...fact,
        occurredAt: command.data.occurredAtMs,
      }));
    },
  };
}

function serviceOf(store: InMemoryConnections): SsoConnectionService {
  return new SsoConnectionService(
    new SsoConnectionGuards({
      connections: store,
      breakGlass: new StubBreakGlassBindings(true),
      stranding: new StubStranding([]),
      // The grandfather verb states history and runs no operator gate; an
      // empty operator set proves it does not need one.
      platformOperators: new StubPlatformOperators(),
      licenseAuthority: new StubLicenseAuthority(),
    }),
    ledger,
  );
}

function grandfatherOf({
  legacyRouting,
  connectionRouting,
  ssoDomain = "acme.com",
}: {
  legacyRouting: SignInDomainRoutingPort;
  connectionRouting: SignInDomainRoutingPort;
  ssoDomain?: string;
}) {
  return new SsoConnectionGrandfatherService({
    connections: serviceOf(connections),
    legacy: {
      findLegacySso: async () => ({ ssoDomain, ssoProvider: "okta" }),
    },
    legacyRouting,
    connectionRouting,
    idpMetadataFor: () => IDP,
    now: () => T0,
  });
}

beforeEach(() => {
  connections = new InMemoryConnections();
  ledger = inMemoryLedger(connections);
});

describe("the sso connection grandfather migration", () => {
  describe("given an organization whose legacy strings still decide sign-in", () => {
    /** @scenario "A grandfathered organization finalizes on routing agreement" */
    it("compares both lookups for every domain and finalizes on agreement", async () => {
      const outcome = await grandfatherOf({
        legacyRouting: new StubRouting({
          "acme.com": routable({ connectionId: `org:${ORG}` }),
        }),
        connectionRouting: new StubRouting({
          "acme.com": routable({ connectionId: "ssoc_gf_org_acme" }),
        }),
      }).migrateOrganization({ organizationId: ORG });

      expect(outcome.status).toBe("finalized");
      expect(outcome.report).toMatchObject({
        kind: "grandfathered",
        connectionId: "ssoc_gf_org_acme",
        domains: ["acme.com"],
      });
    });

    /** @scenario "A grandfathered organization finalizes on routing agreement" */
    it("holds the organization and names the disagreeing domains", async () => {
      const outcome = await grandfatherOf({
        legacyRouting: new StubRouting({
          "acme.com": routable({ connectionId: `org:${ORG}` }),
        }),
        // The projection's answer says the deployment never mounted the
        // method — a real disagreement, and one a person would feel.
        connectionRouting: new StubRouting({
          "acme.com": routable({
            connectionId: "ssoc_gf_org_acme",
            configured: false,
          }),
        }),
      }).migrateOrganization({ organizationId: ORG });

      expect(outcome.status).toBe("migrated");
      expect(outcome.report).toMatchObject({ kind: "routing_disagreement" });
      const report = outcome.report as {
        disagreements: { domain: string }[];
      };
      expect(report.disagreements.map((entry) => entry.domain)).toEqual([
        "acme.com",
      ]);
      // Both answers are on the report: a held organization is a thing an
      // operator has to be able to diagnose without re-running anything.
      expect(report.disagreements[0]).toMatchObject({
        comparison: {
          matches: false,
          legacy: { configured: true },
          connection: { configured: false },
        },
      });
    });
  });

  describe("given the migration has already run once", () => {
    /** @scenario "The grandfather migration is idempotent per organization" */
    it("appends no event on a second pass and still finalizes", async () => {
      const agreeing = () =>
        grandfatherOf({
          legacyRouting: new StubRouting({
            "acme.com": routable({ connectionId: `org:${ORG}` }),
          }),
          connectionRouting: new StubRouting({
            "acme.com": routable({ connectionId: "ssoc_gf_org_acme" }),
          }),
        }).migrateOrganization({ organizationId: ORG });

      const first = await agreeing();
      expect(first.report).toMatchObject({ kind: "grandfathered" });
      expect(
        (first.report as { eventsAppended: number }).eventsAppended,
      ).toBeGreaterThan(0);

      const second = await agreeing();
      expect(second.status).toBe("finalized");
      expect(second.report).toMatchObject({
        kind: "grandfathered",
        eventsAppended: 0,
      });
    });
  });
});
