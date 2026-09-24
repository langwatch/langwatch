import { createServer, type Server } from "node:http";

import type { AgentApi, AgentConnectCredentials } from "@langwatch/agent-contract";
import { WebSocketHost } from "@langwatch/api";
import { createApiFixture } from "@langwatch/api-fixture";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";

import { agentServer } from "../../agent.server.ts";
import { CONNECT_PATH, createAgentWebSocketProtocol } from "../agent-connect.ws.ts";

describe("the connected agents' socket", () => {
  const accepted: AgentConnectCredentials[] = [];
  const host = WebSocketHost.create();
  let server: Server;
  let url: string;

  beforeAll(async () => {
    host.mount(createAgentWebSocketProtocol(), () =>
      createApiFixture<AgentApi>({
        acceptConnection: async (connection, credentials) => {
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
    url = `ws://127.0.0.1:${address.port}${CONNECT_PATH}`;
  });

  afterAll(async () => {
    await host.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  /** @scenario "The agent module declares its socket where main served it" */
  it("is declared among the agent module's transports at main's path", () => {
    expect(CONNECT_PATH).toBe("/api/v1/agents/connect");
    expect(agentServer.transports.some((transport) => transport.protocol === "websocket")).toBe(
      true,
    );
  });

  /** @scenario "An upgrade to the agent socket reaches the agent module with its headers" */
  it("hands the upgrade's three headers to the agent application", async () => {
    const socket = new WebSocket(url, {
      headers: {
        authorization: "Bearer sk-lw-key",
        "x-project-id": "project_1",
        "x-agent-instance-token": "instance_1",
      },
    });
    const code = await new Promise<number>((resolve, reject) => {
      socket.once("close", resolve);
      socket.once("error", reject);
    });

    expect(code).toBe(1000);
    expect(accepted).toEqual([
      { authorization: "Bearer sk-lw-key", projectId: "project_1", instanceToken: "instance_1" },
    ]);
  });
});
