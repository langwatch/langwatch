import { createServer, request as httpRequest, type Server } from "node:http";

import { afterAll, beforeAll, describe, expect, it } from "vitest";
import WebSocket from "ws";
import { z } from "zod";

import { ProjectRequiredError } from "../errors.ts";
import type { RestIdentity } from "../hosting/api-door.ts";
import { recordProjectCredential } from "../rest/credential.ts";
import { bindRestCredential } from "../rest/request.ts";
import {
  type ProtocolConnection,
  type WebSocketCaller,
  type WebSocketSessionCaller,
  WebSocketHost,
  WebSocketProtocol,
} from "../websocket.ts";

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
    /** @scenario "An upgrade to a mounted protocol's path reaches that protocol" */
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
    /** @scenario "An upgrade to a path no protocol mounted is answered 404" */
    it("answers 404 instead of holding the socket open", async () => {
      await expect(upgradeStatus(port, "/api/v1/unknown/connect")).resolves.toBe(404);
    });
  });

  describe("when two protocols declare one path", () => {
    /** @scenario "Two protocols on one path are refused" */
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

  describe("when a protocol declares the project door", () => {
    const credential = {
      type: "legacyProjectKey" as const,
      project: {
        id: "project_1",
        name: "Project",
        slug: "project-one",
        teamId: "team_1",
        organizationId: "org_1",
        isPersonal: false,
        ownerUserId: null,
      },
    };
    const asked: Parameters<RestIdentity["authenticate"]>[0][] = [];
    const door: RestIdentity = {
      authenticate: (input) => {
        asked.push(input);
        if (!input.request.headers.get("x-project-id")) {
          throw new ProjectRequiredError({ projects: [{ id: "project_1", name: "Project" }] });
        }
        recordProjectCredential(input.request, credential);
        return { actor: null, scope: { tier: "project", id: "project_1" } };
      },
    };

    function dooredProtocol(): WebSocketProtocol<EchoApp, typeof facts> {
      return WebSocketProtocol.create({
        path: "/doored",
        maxPayloadBytes: 1024,
        facts,
        headers: { authorization: "authorization" },
        door: {
          credential: "project",
          permission: "scenarios:manage",
          keyKinds: ["legacy_project_key"],
        },
        handle: async (
          app: EchoApp,
          connection: ProtocolConnection,
          { caller }: { caller: WebSocketCaller },
        ) => {
          connection.send(
            JSON.stringify({ app: app.name, admitted: caller.credential.project.id }),
          );
        },
        refuse: async (app: EchoApp, connection, failure) => {
          connection.send(
            JSON.stringify({ app: app.name, refused: (failure as ProjectRequiredError).meta }),
          );
        },
      });
    }

    async function serve(withDoor: boolean): Promise<{ port: number; stop: () => Promise<void> }> {
      const doored = WebSocketHost.create();
      if (withDoor)
        doored.withDoor({ identities: { project: door, organization: door, api_key: door } });
      doored.mount(dooredProtocol(), () => ({ name: "agent" }));
      const listener = createServer((_request, response) => response.writeHead(404).end());
      listener.on("upgrade", (request, socket, head) => doored.upgrade(request, socket, head));
      await new Promise<void>((resolve) => listener.listen(0, resolve));
      const address = listener.address();
      if (address === null || typeof address === "string") throw new Error("no port bound");
      return {
        port: address.port,
        stop: async () => {
          await doored.close();
          await new Promise<void>((resolve) => listener.close(() => resolve()));
        },
      };
    }

    function firstFrame(url: string, headers: Record<string, string>): Promise<unknown> {
      return new Promise((resolve, reject) => {
        const socket = new WebSocket(url, { headers });
        socket.once("message", (data) => {
          resolve(JSON.parse(Buffer.isBuffer(data) ? data.toString("utf8") : ""));
          socket.close();
        });
        socket.once("error", reject);
      });
    }

    it("asks the door its permission and key kinds, then hands the handler the credential", async () => {
      const { port, stop } = await serve(true);
      try {
        await expect(
          firstFrame(`ws://127.0.0.1:${port}/doored`, {
            authorization: "Bearer key",
            "x-project-id": "project_1",
          }),
        ).resolves.toEqual({ app: "agent", admitted: "project_1" });
        expect(asked.at(-1)).toMatchObject({
          permission: "scenarios:manage",
          permissions: ["scenarios:manage"],
          keyKinds: ["legacy_project_key"],
        });
        expect(asked.at(-1)?.request.headers.get("authorization")).toBe("Bearer key");
      } finally {
        await stop();
      }
    });

    it("opens the socket for a refusal and hands it to the protocol's own refuse", async () => {
      const { port, stop } = await serve(true);
      try {
        await expect(
          firstFrame(`ws://127.0.0.1:${port}/doored`, { authorization: "Bearer key" }),
        ).resolves.toEqual({
          app: "agent",
          refused: { projects: [{ id: "project_1", name: "Project" }] },
        });
      } finally {
        await stop();
      }
    });

    it("answers 503 while no API door is open, rather than letting anyone in", async () => {
      const { port, stop } = await serve(false);
      try {
        await expect(upgradeStatus(port, "/doored")).resolves.toBe(503);
      } finally {
        await stop();
      }
    });
  });

  describe("when a protocol declares its module's session key door", () => {
    const session = z.object({ conversationId: z.string() });
    const presented: (string | null)[] = [];
    const door: RestIdentity = {
      authenticate: () => {
        throw new Error("a socket behind the session key door asks no permission");
      },
      identify: ({ request }) => {
        const authorization = request.headers.get("authorization");
        presented.push(authorization);
        if (authorization !== "Bearer minted") throw new ProjectRequiredError({ projects: [] });
        return {
          actor: { type: "user", id: "user_1" },
          scope: { tier: "project", id: "project_1" },
          session: { conversationId: "conversation_1", tokenKey: "dropped" },
        };
      },
    };

    function sessionProtocol(): WebSocketProtocol<EchoApp, typeof facts, typeof session> {
      return WebSocketProtocol.create({
        path: "/session-keyed",
        maxPayloadBytes: 1024,
        facts,
        headers: { authorization: "authorization" },
        door: { credential: "session_key", session },
        handle: async (
          app: EchoApp,
          connection: ProtocolConnection,
          { caller }: { caller: WebSocketSessionCaller<typeof session> },
        ) => {
          connection.send(JSON.stringify({ app: app.name, session: caller.session }));
        },
        refuse: async (app: EchoApp, connection, failure) => {
          connection.send(JSON.stringify({ app: app.name, refused: failure.name }));
        },
      });
    }

    async function serve(bound: boolean): Promise<{ port: number; stop: () => Promise<void> }> {
      const host = WebSocketHost.create();
      host.mount(
        sessionProtocol(),
        () => ({ name: "langy" }),
        bound ? { facts: [bindRestCredential("session_key", () => door)] } : {},
      );
      const listener = createServer((_request, response) => response.writeHead(404).end());
      listener.on("upgrade", (request, socket, head) => host.upgrade(request, socket, head));
      await new Promise<void>((resolve) => listener.listen(0, resolve));
      const address = listener.address();
      if (address === null || typeof address === "string") throw new Error("no port bound");
      return {
        port: address.port,
        stop: async () => {
          await host.close();
          await new Promise<void>((resolve) => listener.close(() => resolve()));
        },
      };
    }

    function firstFrame(url: string, headers: Record<string, string>): Promise<unknown> {
      return new Promise((resolve, reject) => {
        const socket = new WebSocket(url, { headers });
        socket.once("message", (data) => {
          resolve(JSON.parse(Buffer.isBuffer(data) ? data.toString("utf8") : ""));
          socket.close();
        });
        socket.once("error", reject);
      });
    }

    /** @scenario "A socket behind the session key door is admitted by the module's own door" */
    it("asks the module's door and hands the handler its session, parsed", async () => {
      const { port, stop } = await serve(true);
      try {
        await expect(
          firstFrame(`ws://127.0.0.1:${port}/session-keyed`, { authorization: "Bearer minted" }),
        ).resolves.toEqual({ app: "langy", session: { conversationId: "conversation_1" } });
        expect(presented.at(-1)).toBe("Bearer minted");
      } finally {
        await stop();
      }
    });

    /** @scenario "A socket behind the session key door is admitted by the module's own door" */
    it("opens the socket for a refused key and hands it to the protocol's own refuse", async () => {
      const { port, stop } = await serve(true);
      try {
        await expect(
          firstFrame(`ws://127.0.0.1:${port}/session-keyed`, { authorization: "Bearer other" }),
        ).resolves.toEqual({ app: "langy", refused: "ProjectRequiredError" });
      } finally {
        await stop();
      }
    });

    /** @scenario "A socket behind the session key door is admitted by the module's own door" */
    it("answers 503 when the module bound no session key door", async () => {
      const { port, stop } = await serve(false);
      try {
        await expect(upgradeStatus(port, "/session-keyed")).resolves.toBe(503);
      } finally {
        await stop();
      }
    });
  });
});
