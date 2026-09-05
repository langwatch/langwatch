import { IncomingMessage } from "node:http";
import { Socket } from "node:net";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { buildReqShim, directPeerAddressOf } from "../trpc";

type NodeServerEnv = {
  Bindings: { incoming?: IncomingMessage };
};

function incomingMessage(remoteAddress?: string): IncomingMessage {
  const incoming = new IncomingMessage(new Socket());
  if (remoteAddress !== undefined) {
    Object.defineProperty(incoming.socket, "remoteAddress", {
      configurable: true,
      value: remoteAddress,
    });
  }
  return incoming;
}

async function directPeerFrom(incoming?: IncomingMessage) {
  let captured: string | undefined;
  const app = new Hono<NodeServerEnv>();
  app.get("/", (c) => {
    captured = directPeerAddressOf(c);
    return c.body(null, 204);
  });

  await app.request("/", {}, { incoming });
  return captured;
}

describe("the Hono to tRPC request shim", () => {
  it("copies conninfo's direct peer onto the Next request socket", async () => {
    const request = new Request("https://langwatch.test/api/trpc/auth.route", {
      headers: { "x-forwarded-for": "198.51.100.77" },
    });
    const incoming = incomingMessage("203.0.113.9");
    const directPeer = await directPeerFrom(incoming);

    const shim = buildReqShim(request, directPeer, incoming);

    expect(shim.socket.remoteAddress).toBe("203.0.113.9");
    expect(shim.headers["x-forwarded-for"]).toBe("198.51.100.77");
  });

  it("leaves the socket peer absent when Hono has no Node connection", async () => {
    const directPeer = await directPeerFrom();
    const shim = buildReqShim(
      new Request("https://langwatch.test/api/trpc/auth.route"),
      directPeer,
    );

    expect(directPeer).toBeUndefined();
    expect(shim.socket.remoteAddress).toBeUndefined();
  });
});
