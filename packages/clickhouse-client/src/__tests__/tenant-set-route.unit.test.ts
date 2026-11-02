import { describe, expect, it } from "vitest";

import { ClickHouseQueryClient } from "../client.ts";
import { ClickHouseConfigService } from "../config.ts";
import { ClickHouseConnection } from "../connection.ts";
import type { QueryDriver } from "../query.ts";
import { createTenantRouter, parseRoutingTable, PrivateRouteUnavailableError } from "../tenancy.ts";
import { TenantGuard, TenantScopeError } from "../tenantGuard.ts";

const ORGANIZATION_OF: Readonly<Record<string, string>> = {
  "project-private": "org-private",
  "project-private-2": "org-private",
  "project-labelled": "org-labelled",
  "project-plain": "org-plain",
};

const RECORDED_LABEL_OF: Readonly<Record<string, string>> = {
  "org-private": "acme",
  "org-labelled": "globex",
};

const PRIVATE_URL = "http://route-user:route-secret@private.invalid:8123/acme_db";

function fixture() {
  const connection = ClickHouseConnection.create({
    configuration: ClickHouseConfigService.create().resolve({
      shared: { url: "http://shared.invalid:8123", cluster: "test" },
      privateRoutes: [{ organizationId: "org-private", url: PRIVATE_URL, cluster: "test" }],
    }),
    router: createTenantRouter({
      table: parseRoutingTable({}),
      directory: {
        organizationForTenant: async (tenantId) => ORGANIZATION_OF[tenantId] ?? null,
        recordedPrivateDataplaneOf: async (organizationId) => ({
          clickhouseLabel: RECORDED_LABEL_OF[organizationId] ?? null,
          s3Label: null,
        }),
      },
    }),
    clientFactory: { create: () => ({ close: async () => undefined }) },
  });
  const route = (tenantIds: readonly string[]) =>
    connection.routeTenantSet({ tenantId: tenantIds[0] ?? "", tenantIds });
  return { connection, route };
}

describe("ClickHouseConnection.routeTenantSet", () => {
  describe("given a tenant set of one organisation with a private route", () => {
    it("routes it to that organisation's server", async () => {
      const { route } = fixture();

      await expect(route(["project-private", "project-private-2"])).resolves.toEqual({
        kind: "private",
        organizationId: "org-private",
        url: PRIVATE_URL,
      });
    });
  });

  describe("given a tenant set spanning organisations", () => {
    it("refuses it with a TenantScopeError", async () => {
      const { route } = fixture();

      await expect(route(["project-private", "project-plain"])).rejects.toBeInstanceOf(
        TenantScopeError,
      );
    });
  });

  describe("given an organisation recorded as private whose route is missing", () => {
    it("refuses it, never answering shared", async () => {
      const { route } = fixture();

      await expect(route(["project-labelled"])).rejects.toBeInstanceOf(
        PrivateRouteUnavailableError,
      );
    });
  });

  describe("given an organisation never recorded as private", () => {
    it("routes it to the shared server", async () => {
      const { route } = fixture();

      await expect(route(["project-plain"])).resolves.toEqual({ kind: "shared" });
    });
  });
});

describe("ClickHouseQueryClient.routeOfTenantSet", () => {
  const neverRuns = () => Promise.reject(new Error("routing sends no statement"));
  const driver: QueryDriver = { execute: neverRuns, insert: neverRuns, command: neverRuns };

  describe("given no tenant-set routing", () => {
    it("answers shared", async () => {
      const client = new ClickHouseQueryClient({ driver, tenantGuard: new TenantGuard() });

      await expect(client.routeOfTenantSet({ tenantIds: ["project-plain"] })).resolves.toEqual({
        kind: "shared",
      });
    });
  });

  describe("given the connection's tenant-set routing", () => {
    it("answers and refuses as the connection does", async () => {
      const { route } = fixture();
      const client = new ClickHouseQueryClient({
        driver,
        tenantGuard: new TenantGuard(),
        routeTenantSet: ({ tenantIds }) => route(tenantIds),
      });

      await expect(client.routeOfTenantSet({ tenantIds: ["project-private"] })).resolves.toEqual({
        kind: "private",
        organizationId: "org-private",
        url: PRIVATE_URL,
      });
      await expect(
        client.routeOfTenantSet({ tenantIds: ["project-labelled"] }),
      ).rejects.toBeInstanceOf(PrivateRouteUnavailableError);
    });
  });
});
