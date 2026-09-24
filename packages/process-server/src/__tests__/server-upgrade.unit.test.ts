import http from "node:http";

import { afterEach, describe, expect, it, vi } from "vitest";

import { Server } from "../server.ts";

const logger = { info: vi.fn(), error: vi.fn() };
const activeServers: Server[] = [];

afterEach(async () => {
  await Promise.all(activeServers.splice(0).map((server) => server.close()));
});

function startServer(): Server {
  const server = Server.create({ name: "upgrade-test", logger, ownsProcess: false });
  activeServers.push(server);
  return server;
}

function portOf(server: Server): number {
  const address = server.healthAddress;
  if (address === null || typeof address === "string") throw new Error("no port bound");
  return address.port;
}

function upgradeStatus(server: Server, path: string): Promise<number | undefined> {
  return new Promise((resolve, reject) => {
    const request = http.request({
      port: portOf(server),
      path,
      headers: { Connection: "Upgrade", Upgrade: "websocket" },
    });
    request.once("response", (response) => {
      resolve(response.statusCode);
      response.resume();
    });
    request.once("upgrade", (_response, socket) => {
      socket.destroy();
      resolve(101);
    });
    request.once("error", reject);
    request.end();
  });
}

describe("Server upgrades", () => {
  describe("given no upgrade router was contributed", () => {
    it("answers every upgrade 404", async () => {
      const server = startServer();
      await server.listen();

      await expect(upgradeStatus(server, "/api/v1/agents/connect")).resolves.toBe(404);
    });
  });

  describe("given an upgrade router was contributed", () => {
    it("hands it the upgrade, and closes it before the door at shutdown", async () => {
      const seen: string[] = [];
      const close = vi.fn(async () => {});
      const server = startServer().with({
        upgrade: (request, socket) => {
          seen.push(request.url ?? "");
          socket.write(
            "HTTP/1.1 101 Switching Protocols\r\nConnection: Upgrade\r\nUpgrade: websocket\r\n\r\n",
          );
          socket.destroy();
        },
        close,
      });
      await server.listen();

      await expect(upgradeStatus(server, "/api/v1/langy/control/connect")).resolves.toBe(101);
      expect(seen).toEqual(["/api/v1/langy/control/connect"]);

      await server.close();
      expect(close).toHaveBeenCalledOnce();
    });

    it("refuses a second router", () => {
      const door = { upgrade: () => {}, close: async () => {} };

      expect(() => startServer().with(door).with(door)).toThrow(/already has an upgrade router/);
    });
  });
});
