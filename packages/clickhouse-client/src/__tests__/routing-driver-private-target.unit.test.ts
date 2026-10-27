/**
 * @vitest-environment node
 * @see specs/upgrade/in-app-upgrade.feature
 */
import { describe, expect, it, vi } from "vitest";

import { ClickHouseConfigService } from "../config.ts";
import { ClickHouseConnection } from "../connection.ts";
import { PrivateTargetSchemaError, routingDriver } from "../routingDriver.ts";
import { createTenantRouter, parseRoutingTable } from "../tenancy.ts";

const unknownTable = () =>
  Object.assign(new Error("Table langwatch.new_thing does not exist"), {
    code: "60",
    type: "UNKNOWN_TABLE",
  });

/** A shared and a private server that both fail every read with `failure`. */
function routedOver({ failure }: { failure: () => Error }) {
  const server = () => ({
    query: vi.fn(async (_params: unknown) => {
      throw failure();
    }),
    insert: vi.fn(async (_params: unknown) => {
      throw failure();
    }),
    command: vi.fn(async (_params: unknown) => undefined),
    close: vi.fn(async () => undefined),
  });
  const connection = ClickHouseConnection.create({
    configuration: ClickHouseConfigService.create().resolve({
      shared: { url: "http://shared.invalid:8123", cluster: "test" },
      privateRoutes: [
        { organizationId: "org_private", url: "http://private.invalid:8123", cluster: "acme" },
      ],
    }),
    router: createTenantRouter({
      table: parseRoutingTable({}),
      directory: { organizationForTenant: async () => "org_shared" },
    }),
    clientFactory: { create: server },
  });
  return { driver: routingDriver(connection), connection };
}

describe("routingDriver", () => {
  describe("given a read routed to a private target whose migrations are behind", () => {
    /** @scenario "A ClickHouse read from a private target still catching up answers upgrade_in_progress after admission" */
    it("fails with the target's organisation, the server's code and the raw error as cause", async () => {
      const { driver, connection } = routedOver({ failure: unknownTable });

      try {
        const failed = await driver
          .execute({ tenantId: "", organizationId: "org_private", sql: "SELECT 1" })
          .catch((error: unknown) => error);

        expect(failed).toBeInstanceOf(PrivateTargetSchemaError);
        expect(failed).toMatchObject({ privateTarget: "org_private", code: "60" });
        expect(failed instanceof Error ? failed.cause : undefined).toMatchObject({
          type: "UNKNOWN_TABLE",
        });
      } finally {
        await connection.closeOnce();
      }
    });
  });

  describe("given the same failure on the shared instance", () => {
    /** @scenario "A ClickHouse read the schema is not ready for on a current target stays a 500 after admission" */
    it("rethrows the raw error untagged", async () => {
      const { driver, connection } = routedOver({ failure: unknownTable });

      try {
        const failed = await driver
          .execute({ tenantId: "", sql: "SELECT 1" })
          .catch((error: unknown) => error);

        expect(failed).not.toBeInstanceOf(PrivateTargetSchemaError);
        expect(failed).toMatchObject({ code: "60" });
      } finally {
        await connection.closeOnce();
      }
    });
  });

  describe("given a private target failing for another reason", () => {
    /** @scenario "A ClickHouse read the schema is not ready for on a current target stays a 500 after admission" */
    it("rethrows the raw error untagged", async () => {
      const memory = () => Object.assign(new Error("memory limit exceeded"), { code: "241" });
      const { driver, connection } = routedOver({ failure: memory });

      try {
        const failed = await driver
          .insert({ tenantId: "", organizationId: "org_private", table: "t", rows: [] })
          .catch((error: unknown) => error);

        expect(failed).not.toBeInstanceOf(PrivateTargetSchemaError);
        expect(failed).toMatchObject({ code: "241" });
      } finally {
        await connection.closeOnce();
      }
    });
  });
});
