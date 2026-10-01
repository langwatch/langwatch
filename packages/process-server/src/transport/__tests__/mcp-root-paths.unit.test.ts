/**
 * Main's hosted MCP root paths (platform/app/src/start.ts, mcp/handler.ts MCP_ROUTES) through
 * serve(): a mounted raw HTTP door answers them ahead of every route, as main's listener did.
 * @see specs/setup/socket-mounting.feature
 */

import { createServer, type Server } from "node:http";

import { RawHttpHost, RawHttpProtocol, WebSocketHost } from "@langwatch/api";
import { type NodeHandler, TransportSelection } from "@langwatch/api/hosting";
import { transportPeersOf } from "@langwatch/kernel";
import { createLogger } from "@langwatch/observability";
import type { ProcessMemberSource } from "@langwatch/process-stores";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

import { apiSurface, bearerDoor } from "../api-surface.ts";

type EndpointApp = Readonly<{ name: string }>;

const MAIN_MCP_ROUTES = [
  { method: "POST", path: "/mcp" },
  { method: "GET", path: "/mcp/health" },
  { method: "GET", path: "/sse" },
  { method: "POST", path: "/messages" },
  { method: "POST", path: "/sse/messages" },
  { method: "GET", path: "/.well-known/oauth-protected-resource" },
  { method: "GET", path: "/.well-known/oauth-protected-resource/mcp" },
  { method: "GET", path: "/.well-known/oauth-protected-resource/sse" },
  { method: "GET", path: "/.well-known/oauth-authorization-server" },
  { method: "GET", path: "/.well-known/oauth-authorization-server/mcp" },
  { method: "GET", path: "/.well-known/oauth-authorization-server/sse" },
  { method: "GET", path: "/.well-known/openid-configuration" },
  { method: "POST", path: "/oauth/register" },
  { method: "POST", path: "/oauth/token" },
] as const;

const members: ProcessMemberSource = {
  order: [],
  read: (name) => {
    throw new Error(`the MCP root paths read no ${name}`);
  },
  close: () => Promise.resolve(),
  [Symbol.asyncDispose]: () => Promise.resolve(),
};

const MAIN_METADATA_SUBTREES = [
  "/.well-known/oauth-protected-resource",
  "/.well-known/oauth-authorization-server",
];

const closed: string[] = [];

function mcpDoor(): RawHttpProtocol<EndpointApp> {
  return RawHttpProtocol.create<EndpointApp>({
    paths: MAIN_MCP_ROUTES.map(({ path }) => path).filter(
      (path) => !MAIN_METADATA_SUBTREES.some((subtree) => path.startsWith(`${subtree}/`)),
    ),
    prefixes: MAIN_METADATA_SUBTREES,
    open: (app) => ({
      handle: ({ request, response }) => {
        response
          .writeHead(200, { "Content-Type": "application/json" })
          .end(JSON.stringify({ door: app.name, path: request.url }));
      },
      close: async () => {
        closed.push(app.name);
      },
    }),
  });
}

function servedSurface({ doors }: { doors: RawHttpHost }): NodeHandler {
  const surface = apiSurface({
    members,
    logger: createLogger("process-server:mcp-root-paths-test"),
    stores: { database: false, redis: false },
    bundle: void 0,
    storage: {},
    internalBearers: new Map(),
    instanceAdmin: bearerDoor({ name: "instance-admin", token: void 0 }),
    trustedProxies: void 0,
    executionProxyBaseUrl: void 0,
    publicBaseUrl: void 0,
    production: false,
    selection: TransportSelection.create().rest().browserBundle(false),
    sockets: WebSocketHost.create(),
    doors,
  })(transportPeersOf(() => ({})));
  surface.hosts.rawhttp?.mount(mcpDoor(), () => ({ name: "hosted-mcp" }));
  const handler = surface.serve();
  if (!isNodeHandler(handler)) throw new Error("the api surface composed no handler");
  return handler;
}

const servers: Server[] = [];

async function listen(handler: NodeHandler): Promise<string> {
  const server = createServer(handler);
  servers.push(server);
  await new Promise<void>((listening) => server.listen(0, "127.0.0.1", listening));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("the test server has no port");
  return `http://127.0.0.1:${address.port}`;
}

async function pathsReachingTheApi(origin: string): Promise<string[]> {
  const reached: string[] = [];
  for (const { method, path } of MAIN_MCP_ROUTES) {
    const response = await fetch(`${origin}${path}`, { method });
    const body = await response.text();
    if (body !== "Not Found") reached.push(path);
  }
  return reached;
}

const doors = RawHttpHost.create();
let origin = "";

beforeAll(async () => {
  origin = await listen(servedSurface({ doors }));
});

afterAll(() =>
  Promise.all(servers.map((server) => new Promise<void>((closed) => server.close(() => closed())))),
);

describe("main's hosted MCP root paths", () => {
  describe("when the hosted MCP door is mounted", () => {
    /** @scenario "Main's fourteen MCP root paths reach the API through the raw HTTP door" */
    it("dispatches every one to the door ahead of the routes", async () => {
      expect(await pathsReachingTheApi(origin)).toEqual(MAIN_MCP_ROUTES.map(({ path }) => path));
      for (const { method, path } of MAIN_MCP_ROUTES) {
        const response = await fetch(`${origin}${path}`, { method });
        expect({ path, body: await response.json() }).toEqual({
          path,
          body: { door: "hosted-mcp", path },
        });
      }
    });

    it("hands an unpublished metadata suffix to the door, which answers it", async () => {
      const path = "/.well-known/oauth-protected-resource/elsewhere";
      const response = await fetch(`${origin}${path}`);
      expect(await response.json()).toEqual({ door: "hosted-mcp", path });
    });

    it("leaves a path the door does not claim to the routes", async () => {
      const response = await fetch(`${origin}/mcp/elsewhere`);
      expect(await response.text()).toBe("Not Found");
    });
  });

  describe("when the process shuts down", () => {
    it("closes the door the surface mounted", async () => {
      await doors.close();
      expect(closed).toEqual(["hosted-mcp"]);
    });
  });
});

function isNodeHandler(value: unknown): value is NodeHandler {
  return typeof value === "function";
}
