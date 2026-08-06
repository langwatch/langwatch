import { Hono } from "hono";
import { describe, expect, it } from "vitest";

import { safeBodyLimit } from "../safeBodyLimit";

const app = new Hono().post(
  "/ingest",
  safeBodyLimit({ maxSize: 64 }),
  async (c) => {
    const text = await c.req.text();
    return c.json({ received: text });
  },
);

const streamBody = (payload: string): ReadableStream<Uint8Array> =>
  new ReadableStream({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(payload));
      controller.close();
    },
  });

describe("safeBodyLimit", () => {
  describe("when the request declares a content-length", () => {
    it("passes an in-budget body straight through", async () => {
      const res = await app.request("/ingest", {
        method: "POST",
        body: "small payload",
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ received: "small payload" });
    });

    it("rejects an over-budget declared length with 413", async () => {
      const res = await app.request("/ingest", {
        method: "POST",
        body: "x".repeat(100),
      });
      expect(res.status).toBe(413);
    });
  });

  describe("when the request streams with no content-length (the OTLP exporter shape)", () => {
    // This is the path where hono's own bodyLimit rebuilt the request as
    // `new Request(c.req.raw, …)` and crashed cross-realm under the
    // bundled server — the rebuild here must preserve the body for the
    // downstream handler without ever introspecting the original Request.
    it("counts the stream and hands the downstream handler the full body", async () => {
      const res = await app.request("/ingest", {
        method: "POST",
        body: streamBody("streamed payload"),
        // @ts-expect-error duplex is required for stream bodies in undici
        duplex: "half",
      });
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ received: "streamed payload" });
    });

    it("rejects an over-budget stream with 413 without buffering past the limit", async () => {
      const res = await app.request("/ingest", {
        method: "POST",
        body: streamBody("y".repeat(200)),
        // @ts-expect-error duplex is required for stream bodies in undici
        duplex: "half",
      });
      expect(res.status).toBe(413);
    });
  });
});
