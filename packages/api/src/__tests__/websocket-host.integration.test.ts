import { createServer, request as httpRequest, type Server } from "node:http";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { z } from "zod";

import { WebSocketHost, WebSocketProtocol } from "../websocket.ts";

const facts = z.object({ authorization: z.string().optional() });

type EchoApp = { name: string };

function echoProtocol(path: string): WebSocketProtocol<EchoApp, typeof facts> {
  return WebSocketProtocol.create({
    path,
    maxPayloadBytes: 1024,
    facts,
    headers: { authorization: "authorization" },
    handle: async (app: EchoApp, connection, credentials) => {
      connection.send(JSON.stringify({ app: app.name, authorization: credentials.authorization }));
      connection.onMessage((message) => connection.send(message));
    },
  });
}

function firstMessage(url: string): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const socket = new WebSocket(url, { headers: { authorization: "Bearer key" } });
    socket.once("message", (data) => {
      resolve(JSON.parse(Buffer.isBuffer(data) ? data.toString("utf8") : ""));
      socket.close();
    });
    socket.once("error", reject);
  });
}

function upgradeStatus(port: number, path: string): Promise<number | undefined> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({
      port,
      path,
      headers: {
        Connection: "Upgrade",
        Upgrade: "websocket",
        "Sec-WebSocket-Version": "13",
        "Sec-WebSocket-Key": "dGhlIHNhbXBsZSBub25jZQ==",
      },
    });
    req.once("response", (response) => {
      resolve(response.statusCode);
      response.resume();
    });
    req.once("upgrade", () => resolve(101));
    req.once("error", reject);
    req.end();
  });
}

describe("WebSocketHost", () => {
  const host = WebSocketHost.create();
  let server: Server;
  let port: number;

  beforeAll(async () => {
    host.mount(echoProtocol("/api/v1/agents/connect"), () => ({ name: "agent" }));
    host.mount(echoProtocol("/api/v1/langy/control/connect"), () => ({ name: "langy" }));
    server = createServer((_request, response) => response.writeHead(404).end());
    server.on("upgrade", (request, socket, head) => host.upgrade(request, socket, head));
    await new Promise<void>((resolve) => server.listen(0, resolve));
    const address = server.address();
    if (address === null || typeof address === "string") throw new Error("no port bound");
    port = address.port;
  });

  afterAll(async () => {
    await host.close();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  describe("when an upgrade names a mounted protocol's path", () => {
    it("reaches that protocol with its own app and declared facts", async () => {
      await expect(firstMessage(`ws://127.0.0.1:${port}/api/v1/agents/connect`)).resolves.toEqual({
        app: "agent",
        authorization: "Bearer key",
      });
      await expect(
        firstMessage(`ws://127.0.0.1:${port}/api/v1/langy/control/connect?x=1`),
      ).resolves.toEqual({ app: "langy", authorization: "Bearer key" });
    });
  });

  describe("when an upgrade names a path no protocol mounted", () => {
    it("answers 404 instead of holding the socket open", async () => {
      await expect(upgradeStatus(port, "/api/v1/unknown/connect")).resolves.toBe(404);
    });
  });

  describe("when two protocols declare one path", () => {
    it("refuses the second mount by path", () => {
      const other = WebSocketHost.create();
      other.mount(echoProtocol("/same"), () => ({ name: "first" }));

      expect(() => other.mount(echoProtocol("/same"), () => ({ name: "second" }))).toThrow(
        /already registered for \/same/,
      );
    });
  });

  describe("when a transport that is not a socket protocol is mounted", () => {
    it("refuses it by kind", () => {
      expect(() => WebSocketHost.create().mount({}, () => ({}))).toThrow(TypeError);
    });
  });
});
