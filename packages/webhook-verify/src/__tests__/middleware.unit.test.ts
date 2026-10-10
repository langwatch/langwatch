import { createHmac } from "node:crypto";

import { describe, expect, it } from "vitest";

import { langwatchWebhook as expressWebhook } from "../express.ts";
import { langwatchWebhook as honoWebhook } from "../hono.ts";

const SECRET = "content-marker";
const BODY = '{"batch":[{"id":"evt_1"}]}';
const NOW = Math.floor(Date.now() / 1000);
const GOOD = `t=${NOW},v1=${createHmac("sha256", SECRET).update(`${NOW}.${BODY}`).digest("hex")}`;
const BAD = `t=${NOW},v1=${"0".repeat(64)}`;

function honoContext(signature: string) {
  const raw = new Request("https://receiver.example.test/hooks", {
    method: "POST",
    body: BODY,
    headers: { "X-LangWatch-Signature": signature },
  });
  return {
    req: { raw, header: (name: string) => raw.headers.get(name) ?? undefined },
    json: (body: unknown, status: 401) => Response.json(body, { status }),
  };
}

describe("langwatchWebhook for Hono", () => {
  describe("when a signed and a wrongly signed delivery arrive", () => {
    /** @scenario "The Hono middleware refuses an unsigned delivery and passes a signed one" */
    it("calls the handler for the signed one and answers 401 for the other", async () => {
      const middleware = honoWebhook({ secret: SECRET });
      const good = honoContext(GOOD);
      let handled = "";

      const passed = await middleware(good, async () => {
        handled = await good.req.raw.text();
      });
      const refused = await middleware(honoContext(BAD), async () => {
        throw new Error("the handler must not run");
      });

      expect(passed).toBeUndefined();
      expect(handled).toBe(BODY);
      expect(refused?.status).toBe(401);
      expect(await refused?.json()).toEqual({ error: "invalid_signature" });
    });
  });
});

describe("langwatchWebhook for Express", () => {
  describe("when a signed and a wrongly signed delivery arrive after express.raw()", () => {
    /** @scenario "The Express middleware refuses an unsigned delivery and passes a signed one" */
    it("calls next for the signed one and answers 401 for the other", async () => {
      const middleware = expressWebhook({ secret: SECRET });
      const run = (signature: string) =>
        new Promise<{ next?: unknown[]; status?: number; body?: unknown }>((resolve) => {
          void middleware(
            { body: new TextEncoder().encode(BODY), header: () => signature },
            {
              status: (status: number) => ({ json: (body: unknown) => resolve({ status, body }) }),
            },
            (...args: unknown[]) => resolve({ next: args }),
          );
        });

      expect(await run(GOOD)).toEqual({ next: [] });
      expect(await run(BAD)).toEqual({ status: 401, body: { error: "invalid_signature" } });
    });
  });
});
