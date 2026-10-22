/** @vitest-environment node */

import { Hono } from "hono";
import { describe, expect, it } from "vitest";

import { RESOLVED_ERROR, type ResolvedError } from "../../errors.ts";
import { recordForwardedFailure } from "../request.ts";

async function resolvedAfter(response: Response): Promise<ResolvedError | undefined> {
  let resolved: ResolvedError | undefined;
  const app = new Hono();
  app.get("/probe", async (c) => {
    await recordForwardedFailure(c, response);
    resolved = c.get(RESOLVED_ERROR) as ResolvedError | undefined;

    return c.text("ok");
  });
  await app.request("/probe");

  return resolved;
}

describe("recordForwardedFailure()", () => {
  describe("when a route forwards a 5xx answer", () => {
    it("names the forwarded body as the cause and keeps the status", async () => {
      const response = new Response('{"message":"canary timed out"}', { status: 503 });

      const resolved = await resolvedAfter(response);

      expect(resolved?.status).toBe(503);
      expect((resolved?.error as Error).name).toBe("ForwardedServerError");
      expect((resolved?.error as Error).message).toContain("canary timed out");
    });

    it("leaves the forwarded response readable", async () => {
      const response = new Response("still here", { status: 502 });

      await resolvedAfter(response);

      expect(await response.text()).toBe("still here");
    });

    it("bounds the body it quotes", async () => {
      const resolved = await resolvedAfter(new Response("x".repeat(5000), { status: 500 }));

      expect((resolved?.error as Error).message.length).toBeLessThan(400);
    });
  });

  describe("when the forwarded answer is not a server failure", () => {
    it("records no cause", async () => {
      expect(await resolvedAfter(new Response("{}", { status: 200 }))).toBeUndefined();
      expect(await resolvedAfter(new Response("{}", { status: 404 }))).toBeUndefined();
    });
  });
});
