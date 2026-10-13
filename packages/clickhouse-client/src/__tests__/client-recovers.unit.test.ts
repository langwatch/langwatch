/** Spec: specs/private-dataplane/clickhouse-routing.feature */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

import { createClient } from "@clickhouse/client";
import { afterEach, describe, expect, it } from "vitest";

import { ClickHouseQueryClient, ClickHouseUnavailableErrorFactory } from "../client.ts";
import { ClickHouseConfigService } from "../config.ts";
import { ClickHouseConnection } from "../connection.ts";
import { routingDriver } from "../routingDriver.ts";
import { createTenantRouter, parseRoutingTable } from "../tenancy.ts";
import { TenantGuard } from "../tenantGuard.ts";

class Refused extends Error {
  constructor(readonly cause: Error) {
    super("clickhouse_unavailable");
  }
}

class RefusalFactory extends ClickHouseUnavailableErrorFactory {
  create({ cause }: { cause: Error }): unknown {
    return new Refused(cause);
  }
}

const read = {
  tenantId: "project-a",
  sql: "SELECT TraceId FROM trace_summaries WHERE TenantId = {tenantId:String}",
  params: { tenantId: "project-a" },
};

/** A stand-in ClickHouse answering one JSONEachRow row; `dropping` resets every connection. */
function standIn() {
  const state = { dropping: false };
  const server = createServer((request, response) => {
    if (state.dropping) {
      request.socket.destroy();
      return;
    }
    request.resume();
    request.on("end", () => {
      response.writeHead(200, { "Content-Type": "application/x-ndjson" });
      response.end(`${JSON.stringify({ TraceId: "trace-1" })}\n`);
    });
  });
  return { server, state };
}

const listen = (server: Server, port = 0): Promise<number> =>
  new Promise((resolve) => {
    server.listen(port, "127.0.0.1", () => resolve((server.address() as AddressInfo).port));
  });

const close = (server: Server): Promise<void> =>
  new Promise((resolve) => {
    server.closeAllConnections();
    server.close(() => resolve());
  });

/** The process's read path over one shared endpoint, counting the vendor clients it builds. */
function readPathTo(port: number) {
  const built = { count: 0 };
  const connection = ClickHouseConnection.create({
    configuration: ClickHouseConfigService.create().resolve({
      shared: { url: `http://127.0.0.1:${port}`, cluster: "test" },
    }),
    router: createTenantRouter({
      table: parseRoutingTable({}),
      directory: { organizationForTenant: async () => "org-shared" },
    }),
    clientFactory: {
      create: ({ url }) => {
        built.count += 1;
        return createClient({ url });
      },
    },
  });
  const client = new ClickHouseQueryClient({
    driver: routingDriver(connection),
    tenantGuard: new TenantGuard(),
    unavailableErrorFactory: new RefusalFactory(),
  });
  return { client, connection, built };
}

const servers: Server[] = [];
const connections: ClickHouseConnection<ReturnType<typeof createClient>>[] = [];

afterEach(async () => {
  await Promise.all(connections.splice(0).map((connection) => connection.closeOnce()));
  await Promise.all(servers.splice(0).map((server) => close(server)));
});

describe("ClickHouseQueryClient over the routing driver", () => {
  describe("given a ClickHouse that refused the connection and then came back", () => {
    /** @scenario "A ClickHouse that comes back answers again with no restart" */
    it("answers the next read on the same vendor client", async () => {
      const probe = standIn();
      const port = await listen(probe.server);
      await close(probe.server);
      const path = readPathTo(port);
      connections.push(path.connection);

      const refused = await path.client.query(read).catch((error: unknown) => error);
      expect(refused).toBeInstanceOf(Refused);
      expect(((refused as Refused).cause as { code?: string }).code).toBe("ECONNREFUSED");

      const back = standIn();
      servers.push(back.server);
      await listen(back.server, port);

      const answer = await path.client.query<{ TraceId: string }>(read);
      expect(answer.rows).toEqual([{ TraceId: "trace-1" }]);
      expect(path.built.count).toBe(1);
    });
  });

  describe("given a ClickHouse that dropped its connections and then answered again", () => {
    /** @scenario "A ClickHouse that comes back answers again with no restart" */
    it("opens a fresh socket for the next read instead of keeping the dropped one", async () => {
      const flaky = standIn();
      servers.push(flaky.server);
      const port = await listen(flaky.server);
      const path = readPathTo(port);
      connections.push(path.connection);

      expect((await path.client.query(read)).rows).toHaveLength(1);
      flaky.state.dropping = true;
      expect(await path.client.query(read).catch((error: unknown) => error)).toBeInstanceOf(
        Refused,
      );
      flaky.state.dropping = false;

      expect((await path.client.query(read)).rows).toEqual([{ TraceId: "trace-1" }]);
      expect(path.built.count).toBe(1);
    });
  });
});
