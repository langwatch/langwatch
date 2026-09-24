import { createServer, type Server } from "node:http";

import { WebSocketHost } from "@langwatch/api";
import { createApiFixture } from "@langwatch/api-fixture";
import type { LangyApi, LocalControlConnectCredentials } from "@langwatch/langy-contract";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";

import { langyServer } from "../../langy.server.ts";
import {
  CONTROL_CONNECT_PATH,
  createLangyLocalControlWebSocketProtocol,
} from "../langy-local-control.ws.ts";

describe("the local folder's socket", () => {
  const accepted: LocalControlConnectCredentials[] = [];
  const host = WebSocketHost.create();
  let server: Server;
  let url: string;

  beforeAll(async () => {
    host.mount(createLangyLocalControlWebSocketProtocol(), () =>
      createApiFixture<LangyApi>({
        acceptLocalControlConnection: async (connection, credentials) => {
          accepted.push(credentials);
          connection.close(1000, "seen");
        },
      }),
    );
    server = createServer((_request, response) => response.writeHead(404).end());
    server.on("upgrade", (request, socket, head) => host.upgrade(request, socket, head));
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("no port bound");
    url = `ws://127.0.0.1:${address.port}${CONTROL_CONNECT_PATH}`;
  });

  afterAll(async () => {
    await host.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  /** @scenario "The langy module declares the local folder's socket where main served it" */
  it("is declared among the langy module's transports at main's path", () => {
    expect(CONTROL_CONNECT_PATH).toBe("/api/v1/langy/control/connect");
    expect(langyServer.transports.some((transport) => transport.protocol === "websocket")).toBe(
      true,
    );
  });

  /** @scenario "An upgrade to the local folder's socket reaches langy with the session key" */
  it("hands the session key and project to the langy application", async () => {
    const socket = new WebSocket(url, {
      headers: {
        authorization: "Bearer lwsk-key",
        "x-project-id": "project_1",
      },
    });
    const code = await new Promise<number>((resolve, reject) => {
      socket.once("close", resolve);
      socket.once("error", reject);
    });

    expect(code).toBe(1000);
    expect(accepted).toEqual([{ authorization: "Bearer lwsk-key", projectId: "project_1" }]);
  });
});
