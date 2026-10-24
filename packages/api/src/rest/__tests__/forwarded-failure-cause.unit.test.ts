/** @vitest-environment node */

import { Hono } from "hono";
import { describe, expect, it } from "vitest";

import { RESOLVED_ERROR, type ResolvedError } from "../../errors.ts";
import { recordForwardedFailure } from "../request.ts";

async function resolvedAfter(response: Response): Promise<ResolvedError | undefined> {
  let resolved: ResolvedError | undefined;
  const app = new Hono<{ Variables: { [RESOLVED_ERROR]?: ResolvedError } }>();
  app.get("/probe", (c) => {
    recordForwardedFailure(c, response);
    resolved = c.get(RESOLVED_ERROR);

    return c.text("ok");
  });
  await app.request("/probe");

  return resolved;
}

function causeOf(resolved: ResolvedError | undefined): Error {
  if (!(resolved?.error instanceof Error)) throw new Error("no cause was recorded");

  return resolved.error;
}

describe("recordForwardedFailure()", () => {
  describe("when a route forwards a 5xx answer", () => {
    /** @scenario "A forwarded server failure names its status as the cause, never its body" */
    it("names the forwarded status as the cause", async () => {
      const resolved = await resolvedAfter(
        new Response('{"message":"canary timed out"}', { status: 503 }),
      );

      expect(resolved?.status).toBe(503);
      expect(causeOf(resolved).name).toBe("ForwardedServerError");
    });

    /** @scenario "A forwarded server failure names its status as the cause, never its body" */
    it("keeps the forwarded body out of the cause", async () => {
      const resolved = await resolvedAfter(
        new Response('{"message":"user prompt: secret"}', { status: 500 }),
      );

      expect(causeOf(resolved).message).not.toContain("secret");
    });

    /** @scenario "A forwarded server failure names its status as the cause, never its body" */
    it("leaves the forwarded response unread", async () => {
      const response = new Response("still here", { status: 502 });

      await resolvedAfter(response);

      expect(response.bodyUsed).toBe(false);
      expect(await response.text()).toBe("still here");
    });
  });

  describe("when the forwarded answer is not a server failure", () => {
    it("records no cause", async () => {
      expect(await resolvedAfter(new Response("{}", { status: 200 }))).toBeUndefined();
      expect(await resolvedAfter(new Response("{}", { status: 404 }))).toBeUndefined();
    });
  });
});
