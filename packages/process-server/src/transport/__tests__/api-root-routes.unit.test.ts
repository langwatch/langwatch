/**
 * Root-level API paths reach the API through the process's own muxer: the discovery documents
 * and a family declared at the root, never the browser application's fallback.
 * @see packages/api/specs/api-discovery.feature
 */

import { createServer } from "node:http";

import { RawHttpHost, WebSocketHost } from "@langwatch/api";
import { type NodeHandler, TransportSelection } from "@langwatch/api/hosting";
import { defineRestRouter } from "@langwatch/api/rest";
import { moduleApi } from "@langwatch/kernel";
import { createLogger } from "@langwatch/observability";
import type { ProcessMemberSource } from "@langwatch/process-stores";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { z } from "zod";

import { peersWithDoor } from "../../__tests__/support/api-door.ts";
import { apiSurface, bearerDoor } from "../api-surface.ts";

interface ReceiverApi {
  receive(): Promise<{ received: true }>;
}
const ReceiverApi = moduleApi<ReceiverApi>()("trace");
const receiver: ReceiverApi = { receive: () => Promise.resolve({ received: true }) };

const rootFamily = defineRestRouter(ReceiverApi)
  .withNamespace("otel")
  .withVersion("2026-09-24")
  .withAddressing("literal", { v1Twin: false })
  .post("/v1/traces", "receiveRootTraces")
  .withAccess({ kind: "public", reason: "The test receiver authenticates nothing." })
  .withOutput(z.object({ received: z.literal(true) }))
  .withDocs({ hide: true })
  .handle(async ({ app }) => app.receive())
  .build();

const members: ProcessMemberSource = {
  order: [],
  read: (name) => {
    throw new Error(`the root routes read no ${name}`);
  },
  close: () => Promise.resolve(),
  [Symbol.asyncDispose]: () => Promise.resolve(),
};

const surface = apiSurface({
  members,
  logger: createLogger("process-server:api-root-routes-test"),
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
  doors: RawHttpHost.create(),
})(peersWithDoor({ resolve: () => ({}) }));
const rest = surface.hosts.rest;
if (!rest) throw new Error("the surface selected REST");
rest.mount(rootFamily.router(), () => receiver);

const handler = surface.serve();
if (!isNodeHandler(handler)) throw new Error("the api surface composed no handler");
const server = createServer(handler);
let origin = "";

beforeAll(async () => {
  await new Promise<void>((listening) => server.listen(0, "127.0.0.1", listening));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("the test server has no port");
  origin = `http://127.0.0.1:${address.port}`;
});

afterAll(() => new Promise<void>((closed) => server.close(() => closed())));

const request = (path: string, init?: RequestInit) => fetch(`${origin}${path}`, init);
const DOCUMENT_LOCATIONS = [
  "/.well-known/openapi",
  "/api/openapi.json",
  "/api/gateway/v1/openapi.json",
];

describe("the OpenAPI document", () => {
  /** @scenario "The description is served at the well-known location" */
  /** @scenario "The description is served under the API namespace" */
  /** @scenario "The canonical gateway location keeps answering" */
  /** @scenario "Discovery needs no credential" */
  it("is served as JSON, without a credential, at every location", async () => {
    for (const path of DOCUMENT_LOCATIONS) {
      const response = await request(path);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).toContain("application/json");
      const document: { openapi: string; info: { title: string } } = await response.json();
      expect(document.openapi).toBe("3.1.0");
      expect(document.info.title).toBe("LangWatch API");
    }
  });

  /** @scenario "Every location serves one document, not three" */
  /** @scenario "Every location offers the same entity tag for the same document" */
  it("is one document under one entity tag at every location", async () => {
    const responses = await Promise.all(DOCUMENT_LOCATIONS.map((path) => request(path)));
    const bodies = await Promise.all(responses.map((response) => response.text()));
    const tags = responses.map((response) => response.headers.get("etag"));

    expect(new Set(bodies).size).toBe(1);
    expect(tags[0]).toMatch(/^"[\w-]+"$/);
    expect(new Set(tags).size).toBe(1);
  });

  /** @scenario "Fetching the document twice returns the same document" */
  it("is identical when fetched twice and declares the length it sent", async () => {
    const first = await request("/.well-known/openapi");
    const second = await request("/.well-known/openapi");
    const [firstBody, secondBody] = [await first.text(), await second.text()];

    expect(secondBody).toBe(firstBody);
    expect(first.headers.get("content-length")).toBe(String(Buffer.byteLength(firstBody)));
    expect(second.headers.get("content-length")).toBe(String(Buffer.byteLength(secondBody)));
  });

  /** @scenario "A caller that already holds the document is told so" */
  it("answers not modified, with no body, to a caller offering the current tag", async () => {
    const etag = (await request("/api/openapi.json")).headers.get("etag") ?? "";
    const response = await request("/.well-known/openapi", {
      headers: { "if-none-match": `W/${etag}` },
    });

    expect(response.status).toBe(304);
    expect(await response.text()).toBe("");
  });

  /** @scenario "A caller holding a stale tag gets the document" */
  it("sends the document to a caller offering a stale tag", async () => {
    const response = await request("/.well-known/openapi", {
      headers: { "if-none-match": '"stale"' },
    });

    expect(response.status).toBe(200);
  });

  /** @scenario "A discovery location answers only GET" */
  it("refuses a POST to a discovery location", async () => {
    for (const path of [...DOCUMENT_LOCATIONS, "/llms.txt"]) {
      const response = await request(path, { method: "POST" });
      expect(response.status).toBe(404);
    }
  });
});

describe("the plain-text index", () => {
  /** @scenario "The plain-text index names the service and points at the schema" */
  it("is plain text naming LangWatch and linking the document", async () => {
    const response = await request("/llms.txt");
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toContain("text/plain");
    const text = await response.text();
    expect(text).toContain("# LangWatch");
    expect(text).toContain("(/.well-known/openapi)");
  });

  /** @scenario "The plain-text index leads with the credential we want new callers to send" */
  it("shows the Authorization bearer first and calls X-Auth-Token legacy", async () => {
    const text = await (await request("/llms.txt")).text();

    expect(text.indexOf("Authorization: Bearer")).toBeGreaterThan(-1);
    expect(text.indexOf("Authorization: Bearer")).toBeLessThan(text.indexOf("X-Auth-Token"));
    expect(text).toMatch(/X-Auth-Token`? header is also accepted and is\s+legacy/);
  });

  /** @scenario "The plain-text index stays small enough to read speculatively" */
  it("is far smaller than the document", async () => {
    const index = await (await request("/llms.txt")).text();

    expect(index.length).toBeLessThan(2_000);
  });
});

describe("root-level routing", () => {
  /** @scenario "Root-level discovery paths reach the API, not the SPA fallback" */
  it("dispatches the root discovery paths to the API", async () => {
    for (const path of ["/.well-known/openapi", "/llms.txt"]) {
      const response = await request(path);
      expect(response.status).toBe(200);
      expect(response.headers.get("content-type")).not.toContain("text/html");
    }
  });

  /** @scenario "A trailing slash still reaches the API" */
  it("answers a trailing slash with the same document as the bare path", async () => {
    const bare = await (await request("/.well-known/openapi")).text();
    const slashed = await request("/.well-known/openapi/");

    expect(slashed.status).toBe(200);
    expect(await slashed.text()).toBe(bare);
    expect((await request("/llms.txt/")).status).toBe(200);
  });

  /** @scenario "A path that merely starts with a discovery path is left to the app" */
  it("leaves a path beneath a discovery path to the browser application", async () => {
    for (const path of ["/llms.txt/more", "/.well-known/openapi/more"]) {
      const response = await request(path);
      expect(await response.text()).toBe("Not Found");
    }
  });

  /** @scenario "An endpoint that named the site root" */
  it("dispatches a family's root-level route to the API", async () => {
    const response = await request("/v1/traces", { method: "POST" });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true });
  });
});

function isNodeHandler(value: unknown): value is NodeHandler {
  return typeof value === "function";
}
