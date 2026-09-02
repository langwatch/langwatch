/**
 * @vitest-environment node
 *
 * The branch that decides whether the cap can trust the wire or has to measure
 * the body itself.
 *
 * A `Content-Length` that is not a run of decimal digits states nothing, and
 * reading it as a number anyway is what makes the comparison against the cap
 * false and hands the route a body with no cap at all. Node's own HTTP parser
 * refuses most such headers, but it is not the only thing in front of this
 * middleware: behind the route adapter the header arrives unvalidated, which
 * is also why these cases are driven through the middleware directly rather
 * than over a socket.
 *
 * The wiring they cannot reach, the real bridge and a real chunked upload, is
 * covered in body-limit.integration.test.ts.
 *
 * @see ../body-limit.ts
 */

import type { Context, Next } from "hono";
import { HTTPException } from "hono/http-exception";
import { describe, expect, it } from "vitest";
import { bodyLimit } from "../body-limit";

const ECHO_URL = "http://127.0.0.1/echo";

/** A request whose `Content-Length` is whatever the caller says it is. */
function request({
  payload,
  headers: extra = {},
}: {
  payload: string;
  headers?: Record<string, string>;
}): Request {
  const headers = new Headers({ "content-type": "application/json" });
  for (const [name, value] of Object.entries(extra)) headers.set(name, value);
  return new Request(ECHO_URL, { method: "POST", headers, body: payload });
}

/**
 * Drives the middleware over a stand-in for the Hono context, which is all of
 * it the middleware touches, and reports what the route would have seen.
 */
async function capped({
  maxSize,
  incoming,
}: {
  maxSize: number;
  incoming: Request;
}): Promise<{
  status: number;
  reachedRoute: boolean;
  handedOn: Request;
  drained: boolean;
  body: string | null;
}> {
  const context = { req: { raw: incoming } };
  let reachedRoute = false;
  const next = (() => {
    reachedRoute = true;
    return Promise.resolve();
  }) as Next;

  let status = 200;
  try {
    await bodyLimit({ maxSize })(context as unknown as Context, next);
  } catch (error) {
    if (!(error instanceof HTTPException)) throw error;
    status = error.status;
  }

  const handedOn = context.req.raw;
  const drained = handedOn !== incoming;
  return {
    status,
    reachedRoute,
    handedOn,
    drained,
    body: drained ? await handedOn.text() : null,
  };
}

/** Everything a `Content-Length` can say that is not a size. */
const UNUSABLE_LENGTHS = {
  "a word": "abc",
  "a negative number": "-1",
  "an empty value": "",
  "exponent notation": "1e3",
  "a hexadecimal literal": "0x10",
  "a repeated header collapsed into a list": "12, 13",
  "a size past the safe-integer range": "9".repeat(20),
};

describe("the size the request body cap is willing to trust", () => {
  describe("given a Content-Length that is not a non-negative integer", () => {
    describe("when the body exceeds the cap", () => {
      for (const [description, value] of Object.entries(UNUSABLE_LENGTHS)) {
        it(`refuses a body whose length arrived as ${description}`, async () => {
          const result = await capped({
            maxSize: 16,
            incoming: request({
              payload: "x".repeat(256),
              headers: { "content-length": value },
            }),
          });

          expect(result.status).toBe(413);
          expect(result.reachedRoute).toBe(false);
        });
      }
    });

    describe("when the body fits under the cap", () => {
      it("measures it by draining and hands the route the bytes back", async () => {
        const payload = JSON.stringify({ resourceSpans: [] });
        const result = await capped({
          maxSize: 1024,
          incoming: request({
            payload,
            headers: { "content-length": "abc" },
          }),
        });

        expect(result.status).toBe(200);
        expect(result.reachedRoute).toBe(true);
        expect(result.drained).toBe(true);
        expect(result.body).toBe(payload);
      });
    });
  });

  describe("given no Content-Length at all", () => {
    describe("when the body fits under the cap", () => {
      it("drains it and hands the route the bytes back", async () => {
        const payload = JSON.stringify({ resourceSpans: [] });
        const result = await capped({
          maxSize: 1024,
          incoming: request({ payload }),
        });

        expect(result.status).toBe(200);
        expect(result.reachedRoute).toBe(true);
        expect(result.drained).toBe(true);
        expect(result.body).toBe(payload);
      });
    });

    describe("when the body exceeds the cap", () => {
      it("refuses it", async () => {
        const result = await capped({
          maxSize: 16,
          incoming: request({ payload: "x".repeat(256) }),
        });

        expect(result.status).toBe(413);
        expect(result.reachedRoute).toBe(false);
      });
    });
  });

  describe("given a Transfer-Encoding alongside a Content-Length", () => {
    describe("when the body fits under the cap", () => {
      it("believes the transfer encoding and measures the body itself", async () => {
        const payload = JSON.stringify({ resourceSpans: [] });
        const result = await capped({
          maxSize: 1024,
          incoming: request({
            payload,
            headers: { "content-length": "0", "transfer-encoding": "chunked" },
          }),
        });

        expect(result.drained).toBe(true);
        expect(result.body).toBe(payload);
      });
    });
  });

  describe("given a Content-Length that is a non-negative integer", () => {
    describe("when it exceeds the cap", () => {
      it("refuses the request without reading a byte of it", async () => {
        const incoming = request({
          payload: "x".repeat(256),
          headers: { "content-length": "256" },
        });

        const result = await capped({ maxSize: 16, incoming });

        expect(result.status).toBe(413);
        expect(result.reachedRoute).toBe(false);
        expect(incoming.bodyUsed).toBe(false);
      });
    });

    describe("when it fits under the cap", () => {
      it("passes the request straight through, still unread", async () => {
        const incoming = request({
          payload: "x".repeat(8),
          headers: { "content-length": "8" },
        });

        const result = await capped({ maxSize: 1024, incoming });

        expect(result.reachedRoute).toBe(true);
        expect(result.drained).toBe(false);
        expect(incoming.bodyUsed).toBe(false);
      });
    });

    describe("when it declares an empty body", () => {
      it("passes the request straight through", async () => {
        const result = await capped({
          maxSize: 16,
          incoming: request({
            payload: "",
            headers: { "content-length": "0" },
          }),
        });

        expect(result.reachedRoute).toBe(true);
        expect(result.drained).toBe(false);
      });
    });
  });
});
