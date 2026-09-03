/**
 * The three questions this process's ClickHouse connection answers, and the
 * routing each one takes.
 *
 * They are three rather than one because the ids are not interchangeable: a
 * PROJECT is resolved through the tenant directory, an ORGANIZATION is looked
 * up in the private-route table directly, and the install's own event log is
 * nobody's tenant at all. Handing one accessor another's id is the whole class
 * of bug here — an organization id through the tenant resolver raises
 * `UnknownTenantError`, which is why the billable-events rollup could not be
 * read on this process until the second accessor existed.
 *
 * Only the vendor driver is intercepted: `createClient` opens a real HTTP
 * client per endpoint, and a unit test must not. Everything above it — the
 * config resolution, the routing table and the connection — is real.
 */
import { ResourceScope } from "@langwatch/runtime-composition";
import { describe, expect, it, vi } from "vitest";

const vendor = vi.hoisted(() => ({ createClient: vi.fn() }));

vi.mock("@clickhouse/client", () => ({
  createClient: (options: { url: string }) => {
    vendor.createClient(options.url);
    return { url: options.url, close: async () => {} };
  },
}));

import { ApiClickHouseInfrastructure } from "../api-clickhouse.infrastructure";

const SHARED_URL = "http://clickhouse.shared.test:8123";
const PRIVATE_URL = "http://clickhouse.acme.test:8123";
const PRIVATE_ORGANIZATION = "organization-acme";

const poolSizing = { override: 4 };

/** The endpoint a returned client actually points at. */
function urlOf(client: unknown): string {
  return (client as { url: string }).url;
}

function compose(options: {
  shared?: string | undefined;
  privateRoutes?: readonly { organizationId: string; url: string; cluster: string }[];
  organizationForTenant?: (tenantId: string) => Promise<string | null>;
}) {
  const resources = new ResourceScope();
  const infrastructure = ApiClickHouseInfrastructure.create({
    resources,
    clickhouse: {
      url: options.shared,
      langwatchQl: undefined,
      opsUrl: undefined,
      privateRoutes: options.privateRoutes ?? [],
      poolSizing,
    },
    directory: {
      organizationForTenant:
        options.organizationForTenant ??
        (() => {
          throw new Error("the tenant directory was consulted for a read that has no tenant");
        }),
    },
  });
  return { infrastructure, resources };
}

describe("ApiClickHouseInfrastructure", () => {
  describe("given a deployment with a shared endpoint and one private route", () => {
    /** @scenario "An organization on its own endpoint is routed there without a tenant lookup" */
    it("routes an organization to its own endpoint without consulting the tenant directory", async () => {
      const { infrastructure } = compose({
        shared: SHARED_URL,
        privateRoutes: [
          { organizationId: PRIVATE_ORGANIZATION, url: PRIVATE_URL, cluster: "acme" },
        ],
      });

      // The directory throws if it is reached: an organization id is not a
      // tenant, and looking one up is the failure this accessor exists to
      // avoid rather than an inefficiency.
      const client = await infrastructure.resolveOrganizationClient(PRIVATE_ORGANIZATION);

      expect(urlOf(client)).toBe(PRIVATE_URL);
    });

    /** @scenario "An organization with no private route reads the shared endpoint" */
    it("routes an organization with no private route to the shared endpoint", async () => {
      const { infrastructure } = compose({
        shared: SHARED_URL,
        privateRoutes: [
          { organizationId: PRIVATE_ORGANIZATION, url: PRIVATE_URL, cluster: "acme" },
        ],
      });

      const client = await infrastructure.resolveOrganizationClient("organization-elsewhere");

      expect(urlOf(client)).toBe(SHARED_URL);
    });

    /** @scenario "The install's own shared endpoint answers the read that is nobody's tenant" */
    it("answers the shared endpoint for the read that is nobody's tenant", () => {
      const { infrastructure } = compose({
        shared: SHARED_URL,
        privateRoutes: [
          { organizationId: PRIVATE_ORGANIZATION, url: PRIVATE_URL, cluster: "acme" },
        ],
      });

      expect(urlOf(infrastructure.resolveSharedClient())).toBe(SHARED_URL);
      expect(infrastructure.sharedEndpointConfigured).toBe(true);
    });

    /** @scenario "A project is still routed through the tenant directory" */
    it("still routes a project through the tenant directory, unchanged", async () => {
      const { infrastructure } = compose({
        shared: SHARED_URL,
        privateRoutes: [
          { organizationId: PRIVATE_ORGANIZATION, url: PRIVATE_URL, cluster: "acme" },
        ],
        organizationForTenant: async (tenantId) =>
          tenantId === "project-acme" ? PRIVATE_ORGANIZATION : null,
      });

      expect(urlOf(await infrastructure.resolveClient("project-acme"))).toBe(PRIVATE_URL);
    });

    /** @scenario "The three accessors share one driver per physical endpoint" */
    it("opens one driver per physical endpoint, however the three accessors are mixed", async () => {
      vendor.createClient.mockClear();
      const { infrastructure } = compose({
        shared: SHARED_URL,
        privateRoutes: [
          { organizationId: PRIVATE_ORGANIZATION, url: PRIVATE_URL, cluster: "acme" },
        ],
        organizationForTenant: async () => PRIVATE_ORGANIZATION,
      });

      await infrastructure.resolveOrganizationClient(PRIVATE_ORGANIZATION);
      await infrastructure.resolveClient("project-acme");
      infrastructure.resolveSharedClient();
      await infrastructure.resolveOrganizationClient("organization-elsewhere");

      // Two endpoints, two drivers: the second accessor reuses the pool the
      // process already holds rather than opening one of its own.
      expect(vendor.createClient.mock.calls.map(([url]) => url).sort()).toEqual([
        PRIVATE_URL,
        SHARED_URL,
      ]);
    });
  });

  describe("given a deployment holding only private routes", () => {
    /** @scenario "An install holding only private routes reports no shared endpoint" */
    it("reports no shared endpoint rather than throwing at the caller", () => {
      const { infrastructure } = compose({
        privateRoutes: [
          { organizationId: PRIVATE_ORGANIZATION, url: PRIVATE_URL, cluster: "acme" },
        ],
      });

      // Null is a composition fact the caller acts on — it composes the
      // operator's event-log explorer or it names its absence — and a throw
      // here would be discovered at the first operator search instead.
      expect(infrastructure.resolveSharedClient()).toBeNull();
      expect(infrastructure.sharedEndpointConfigured).toBe(false);
    });
  });
});
