import { createConnectedAgentFixture } from "../../__tests__/connected-agent.fixture.ts";
/**
 * The gateway's own heartbeat: an unanswered ping retires the socket, and a
 * mid-registration close leaves nothing behind (ADR-128, "Transport").
 * @see specs/agents/connected-agents.feature
 */
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { IncomingMessage } from "node:http";
import type { Duplex } from "node:stream";
import { PROTOCOL_VERSION } from "@langwatch/agent-contract";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { ConnectedAgentRuntimeService } from "../../services/connected-agent-runtime.service.ts";
import { SessionStateStoreFactory } from "@langwatch/redis-client";
import type { ConnectedAgentCredentials } from "../../services/connected-agent-credential.service.ts";
import type { ConnectUpgradeRouterPort, UpgradeHandler } from "@langwatch/api";
import { CONNECT_PATH } from "../agent-connect.ws.ts";
import { ConnectGatewayFixture } from "./agent-connect-gateway.fixture.ts";

function createUpgradeRouter(server: Server): ConnectUpgradeRouterPort {
  const handlers = new Map<string, UpgradeHandler>();
  server.on("upgrade", (request: IncomingMessage, socket: Duplex, head: Buffer) => {
    const pathname = new URL(request.url ?? "/", "http://localhost").pathname;
    const handler = handlers.get(pathname);
    if (!handler) {
      socket.write("HTTP/1.1 404 Not Found\r\nConnection: close\r\n\r\n");
      socket.destroy();
      return;
    }
    handler(request, socket, head);
  });
  return {
    register(pathname, handler) {
      handlers.set(pathname, handler);
    },
  };
}

class WorkingCredentials implements ConnectedAgentCredentials {
  async resolve() {
    return { project: { id: "proj_1", slug: "proj-1" }, principalId: "key:test", userId: null };
  }
}

const fakeAgents = createConnectedAgentFixture();

function registerFrame(instanceId: string) {
  return {
    protocol: PROTOCOL_VERSION,
    type: "register" as const,
    sdk: { name: "langwatch", version: "1.0.0", language: "python" },
    instance: {
      id: instanceId,
      hostname: "laptop",
      username: "dev",
      pid: 4242,
      startedAt: new Date().toISOString(),
      inFlightCallIds: [],
    },
    agents: [{ name: "support-agent", environment: "production", parameters: {} }],
  };
}

async function startGateway(options: { pingIntervalMs: number; pongWaitMs: number }) {
  const runtime = ConnectedAgentRuntimeService.create({
    podId: "pod_a",
    store: SessionStateStoreFactory.memory(),
  });
  const server = createServer((_request, response) => {
    response.statusCode = 404;
    response.end();
  });
  const gateway = ConnectGatewayFixture.create({
    runtime,
    agents: fakeAgents,
    credentials: new WorkingCredentials(),
    publicBaseUrl: "https://example.test",
    replicaCount: 1,
    ...options,
  });
  gateway.mount(createUpgradeRouter(server));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const url = `ws://127.0.0.1:${(server.address() as AddressInfo).port}${CONNECT_PATH}`;
  return { gateway, server, url };
}

async function connectAndRegister(
  url: string,
  instanceId: string,
  { autoPong = true }: { autoPong?: boolean } = {},
): Promise<WebSocket> {
  const socket = new WebSocket(url, {
    headers: { Authorization: "Bearer sk-lw-anything" },
    autoPong,
  });
  await new Promise<void>((resolve, reject) => {
    socket.once("open", () => {
      socket.send(JSON.stringify(registerFrame(instanceId)));
      resolve();
    });
    socket.once("error", reject);
  });
  await new Promise<void>((resolve) => {
    socket.once("message", (raw) => {
      expect(JSON.parse(raw.toString())).toMatchObject({ type: "registered" });
      resolve();
    });
  });
  return socket;
}

describe("ConnectGateway liveness", () => {
  let cleanup: (() => Promise<void>) | null = null;

  afterEach(async () => {
    await cleanup?.();
    cleanup = null;
  });

  describe("when an instance does not answer a ping inside the pong wait", () => {
    /** @scenario "A missed pong retires the instance" */
    it("closes the socket and drops it from presence", async () => {
      const { gateway, server, url } = await startGateway({
        pingIntervalMs: 20,
        pongWaitMs: 20,
      });
      cleanup = async () => {
        await gateway.close();
        await new Promise<void>((resolve) => server.close(() => resolve()));
      };
      const socket = await connectAndRegister(url, "inst_missed_pong", { autoPong: false });

      await new Promise<void>((resolve) => socket.once("close", () => resolve()));
      // The server's own close handling (unsubscribe, retire) runs after its
      // socket's own "close" event, which can land a tick after the client's.
      await new Promise((resolve) => setTimeout(resolve, 20));

      expect(gateway.sessionCount).toBe(0);
    });
  });

  describe("when the pong lands after the next ping went out, inside its own wait", () => {
    /** @scenario "A pong that lands inside its own wait keeps the socket" */
    it("keeps the socket open", async () => {
      const { gateway, server, url } = await startGateway({
        pingIntervalMs: 15,
        pongWaitMs: 200,
      });
      cleanup = async () => {
        await gateway.close();
        await new Promise<void>((resolve) => server.close(() => resolve()));
      };
      const socket = await connectAndRegister(url, "inst_slow_pong");

      // `ws` answers every ping on its own; give a couple of ping/pong
      // rounds a chance to run, well inside the generous 200ms wait.
      await new Promise((resolve) => setTimeout(resolve, 80));

      expect(socket.readyState).toBe(WebSocket.OPEN);
      expect(gateway.sessionCount).toBe(1);
      socket.close();
      await new Promise<void>((resolve) => socket.once("close", () => resolve()));
    });
  });

  describe("when the socket closes while its registration is still running", () => {
    /** @scenario "A socket that goes away during registration retires its instance" */
    it("holds no connection for it once registration finishes", async () => {
      class SlowCredentials implements ConnectedAgentCredentials {
        async resolve() {
          await new Promise((resolve) => setTimeout(resolve, 50));
          return {
            project: { id: "proj_1", slug: "proj-1" },
            principalId: "key:test",
            userId: null,
          };
        }
      }
      const runtime = ConnectedAgentRuntimeService.create({
        podId: "pod_a",
        store: SessionStateStoreFactory.memory(),
      });
      const server = createServer((_request, response) => {
        response.statusCode = 404;
        response.end();
      });
      const gateway = ConnectGatewayFixture.create({
        runtime,
        agents: fakeAgents,
        credentials: new SlowCredentials(),
        publicBaseUrl: "https://example.test",
        replicaCount: 1,
      });
      gateway.mount(createUpgradeRouter(server));
      await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
      const url = `ws://127.0.0.1:${(server.address() as AddressInfo).port}${CONNECT_PATH}`;
      cleanup = async () => {
        await gateway.close();
        await new Promise<void>((resolve) => server.close(() => resolve()));
      };

      const socket = new WebSocket(url, { headers: { Authorization: "Bearer sk-lw-anything" } });
      await new Promise<void>((resolve, reject) => {
        socket.once("open", () => {
          socket.send(JSON.stringify(registerFrame("inst_gone_mid_register")));
          resolve();
        });
        socket.once("error", reject);
      });
      // The credential resolution is still in flight (SlowCredentials);
      // close the socket before registration can finish.
      socket.terminate();

      // Wait past the credential delay, so registerInstance has run.
      await new Promise((resolve) => setTimeout(resolve, 120));

      expect(gateway.sessionCount).toBe(0);
    });
  });
});
